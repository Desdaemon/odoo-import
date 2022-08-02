import { extname } from "path";
import type ts from "typescript/lib/tsserverlibrary";
import astPatch from "./ast-patch";
import refactors from "./refactors";
import utils from "./utils";
import { Walker } from "./walker";

interface Config {
  addonDirectories?: string[];
}

const VIRTUAL = "#";
const VIRTUAL_LEN = VIRTUAL.length;

/**
 * Since this file needs to be injected before any other code runs,
 * abuse setters to apply these monkeypatches once their targets exist.
 */
function decorate<T, K extends keyof T>(obj: T, prop: K, func: (prop: T[K]) => T[K]) {
  let existingValue = typeof obj[prop] === "function" ? func((obj[prop] as any).bind(obj)) : undefined;

  Object.defineProperty(obj, prop, {
    enumerable: true,
    configurable: true,
    get() {
      return existingValue;
    },
    set(newValue) {
      if (!existingValue) {
        existingValue = func(newValue);
      }
      return existingValue;
    },
  });
}

const odooPragma = "@odoo-module";
const odooClassicDefine = "odoo.define";
const odooModules = /@odoo-module\s+alias=(?<module>.+)\b/g;
const odooDefine = /odoo\s*\.define\s*\(\s*['"](?<classic>.+)['"]/g;
const odooNewImportPattern = /^@(.+?)\/(.+)$/;

function search(src: string, ...needle: string[]) {
  for (const n of needle) {
    if (src.indexOf(n) != -1) return true;
  }
  return false;
}

function exclude<T>(left: T[], right: T[]) {
  return left.filter((elm) => !right.includes(elm));
}

function init(modules: { typescript: typeof ts }) {
  const ts = modules.typescript;
  const { findTopLevelStatement, cached } = utils(ts);
  const { getRefactorInfo, inlineAction, newfileAction, refactorNamespace } = refactors(ts);
  const { replaceFinalReturn } = astPatch(ts);

  let config: Config;
  // let refresh: Function | undefined;
  let refresh: ((old: Config) => any) | undefined;
  const watchers = new Map<string, ts.FileWatcher>();
  function onConfigurationUpdated(config_: Config) {
    const oldConfig = config;
    config = config_;
    refresh?.(oldConfig);
  }

  interface CacheEntry {
    path: string;
    classic: boolean;
    multi: boolean;
    realPath: string;
  }

  function create(info: ts.server.PluginCreateInfo) {
    function log(msg: any, type = ts.server.Msg.Info) {
      info.project.projectService.logger.msg("[odoo] " + typeof msg !== "string" ? JSON.stringify(msg) : msg, type);
    }

    const pwd = info.project.getCurrentDirectory();
    config = info.config;
    log({ config });
    const addonsDir = () =>
      (config.addonDirectories ||= [`${pwd}/addons`]).map((dir) => info.serverHost.resolvePath(dir));
    let cache: Map<string, CacheEntry> = new Map();

    refresh = (old: Config) => {
      const removed = exclude(old.addonDirectories || [], config.addonDirectories || []);
      for (const rem of removed) {
        debugger;
        watchers.get(rem)?.close();
        watchers.delete(rem);
      }
      initWatchers();
      info.project.refreshDiagnostics();
    };

    function updateCache(file: string) {
      const contents = ts.sys.readFile(file);
      if (!contents) {
        for (const [key, removed] of cache.entries()) {
          if (file == removed.path) {
            log(`File removal: ${file}`);
            cache.delete(key);
            info.project.refreshDiagnostics();
            return;
          }
        }
      } else {
        const match = odooModules.exec(contents);
        if (match) {
          const alias = match.groups!.module;
          log(`Found alias ${alias} to ${file} (classic=false)`);
          cache.set(alias, { path: file, classic: false, multi: false, realPath: file });
          info.project.refreshDiagnostics();
          return;
        }

        const matches = [...contents.matchAll(odooDefine)];
        const multi = matches.length > 1;
        for (const match of matches) {
          const alias = match.groups!.classic;
          log(`Found alias ${alias} to ${file} (classic=true)`);
          cache.set(alias, {
            path: multi ? `${file}${VIRTUAL}${alias}${extname(file)}` : file,
            realPath: file,
            classic: true,
            multi,
          });
        }
        if (matches.length) info.project.refreshDiagnostics();
      }
    }

    function initWatchers() {
      for (const dir of [...addonsDir(), pwd]) {
        if (!watchers.has(dir)) {
          watchers.set(
            dir,
            ts.sys.watchDirectory!(dir, updateCache, true, {
              // needed so that ts.sys.readFile doesn't return null for existent file
              synchronousWatchDirectory: true,
            })
          );
        }
      }
    }
    initWatchers();

    const walker = new Walker(ts, ...addonsDir());
    for (const file of walker) {
      updateCache(file);
    }

    const cachedReplaceFinalReturn = cached(replaceFinalReturn);
    decorate(info.serverHost, "readFile", (readFile) => {
      return (path, encoding) => {
        const virtual = path.lastIndexOf(VIRTUAL);
        let file;
        if (virtual != -1) {
          file = readFile(path.substring(0, virtual));
          return (
            file &&
            cachedReplaceFinalReturn(file, path.substring(virtual + VIRTUAL_LEN, path.length - extname(path).length))
          );
        } else {
          file = readFile(path, encoding);
        }
        if (file) {
          for (const [alias, { path: loc, classic }] of cache.entries()) {
            if (path == loc && classic) {
              // info.project.log(JSON.stringify(cachedReplaceFinalReturn.report()));
              return cachedReplaceFinalReturn(file, alias);
            }
          }
        }
        return file;
      };
    });

    decorate(ts.sys, "fileExists", (fileExists) => {
      return (path) => {
        const virtual = path.lastIndexOf(VIRTUAL);
        if (virtual != -1) {
          return fileExists(path.substring(0, virtual));
        } else {
          return fileExists(path);
        }
      };
    });

    decorate(ts, "resolveModuleName", (resolve) => {
      return (name, file, opts, host, cache_, redirected, mode) => {
        if (cache.has(name)) {
          const { realPath } = cache.get(name)!;
          return {
            resolvedModule: {
              resolvedFileName: realPath,
              extension: (extname(realPath) as ts.Extension) || ".js",
            },
            failedLookupLocations: [],
          };
        }
        if (name.startsWith("@") && search(host.readFile(file) || "", odooPragma, odooClassicDefine)) {
          let options = addonsDir().map((dir) => name.replace(odooNewImportPattern, `${dir}/$1/static/src/$2`));
          const redirect: string = options.find((path) => ts.sys.fileExists(path)) || "";
          options = options.filter((e) => e == redirect);
          return {
            resolvedModule: {
              resolvedFileName: redirect,
              extension: (extname(redirect) as ts.Extension) || ".js",
            },
            failedLookupLocations: options,
          };
        }
        return resolve(name, file, opts, host, cache_, redirected, mode);
      };
    });

    const getCompletionsAtPosition = info.languageService.getCompletionsAtPosition;
    info.languageService.getCompletionsAtPosition = (file, pos, opts, fopts) => {
      const comps = getCompletionsAtPosition(file, pos, opts, fopts);
      if (comps && opts?.includeCompletionsForImportStatements) {
        for (const name of cache.keys()) {
          comps.entries.push({
            name,
            kind: ts.ScriptElementKind.externalModuleName,
            sortText: name,
            isImportStatementCompletion: true,
          });
        }
      }
      return comps;
    };

    const getApplicableRefactors = info.languageService.getApplicableRefactors;
    info.languageService.getApplicableRefactors = (name, pos, prefs, reason, kind) => {
      const ret = getApplicableRefactors(name, pos, prefs, reason, kind);
      const [start, end] = typeof pos === "number" ? [pos, null] : [pos.pos, pos.end];
      const src = info.project.getSourceFile(info.project.projectService.toPath(name))!;
      let stmt = findTopLevelStatement(src, start);
      let refactors = stmt && getRefactorInfo(stmt);
      if (end != null && !stmt && !refactors) {
        stmt = findTopLevelStatement(src, end);
        refactors = stmt && getRefactorInfo(stmt);
      }
      if (refactors) ret.push(refactors);
      return ret;
    };

    const getEditsForRefactor = info.languageService.getEditsForRefactor;
    info.languageService.getEditsForRefactor = (name, fopts, pos, refactor, action, prefs) => {
      if (refactor !== refactorNamespace) {
        return getEditsForRefactor(name, fopts, pos, refactor, action, prefs);
      }
      const [start, end] = typeof pos === "number" ? [pos, pos] : [pos.pos, pos.end];
      const src = info.project.getSourceFile(info.project.projectService.toPath(name))!;
      let stmt = findTopLevelStatement(src, start);
      if (!stmt && end != null) {
        stmt = findTopLevelStatement(src, end);
      }

      info.session;

      switch (action) {
        case inlineAction.name:
          return inlineAction.getEdits(name, stmt as any as ts.ExpressionStatement);
        case newfileAction.name:
          return newfileAction.getEdits(name, stmt as any as ts.ExpressionStatement);
        default:
          info.project.log(`Unknown action ${action}`);
      }
    };

    return info.languageService;
  }
  return { create, onConfigurationChanged: onConfigurationUpdated };
}

export = init;
