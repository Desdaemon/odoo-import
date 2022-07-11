import { Walker } from "./walker";

interface Config {
  addonDirectories?: string[]
}

/**
 * Since this file needs to be injected before any other code runs,
 * abuse setters to apply these monkeypatches once their targets exist.
 */
function decorate<T, K extends keyof T>(
  obj: T,
  prop: K,
  func: (prop: T[K]) => T[K]
) {
  var existingValue: T[K] = func(obj[prop]);

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

function replaceLast(src: string, needle: string, replace: string) {
  const idx = src.lastIndexOf(needle);
  if (idx != -1) {
    src = src.slice(0, idx) + replace + src.slice(idx + needle.length);
  }
  return src;
}

function search(src: string, ...needle: string[]) {
  for (const n of needle) {
    if (src.indexOf(n) != -1) return true;
  }
  return false;
}

function init(modules: {
  typescript: typeof import("typescript/lib/tsserverlibrary");
}) {
  const ts = modules.typescript;
  let config: Config;
  let refresh: Function | undefined
  function onConfigurationUpdated(config_: Config) {
    config = config_
    refresh?.()
  }

  function create(info: ts.server.PluginCreateInfo) {
    refresh = info.project.refreshDiagnostics.bind(info.project)
    const pwd = info.project.getCurrentDirectory();
    config = info.config;
    const addonsDir = () => config.addonDirectories ||= [`${pwd}/addons`];
    let cache: Map<string, { loc: string; classic: boolean }> = new Map();

    function log(msg: string, type = ts.server.Msg.Info) {
      info.project.projectService.logger.msg("[odoo] " + msg, type);
    }

    function updateCache(file: string) {
      const contents = ts.sys.readFile(file);
      if (!contents) {
        for (const [key, removed] of cache.entries()) {
          if (file == removed.loc) {
            log(`File removal: ${file}`);
            cache.delete(key);
            info.project.refreshDiagnostics();
            return;
          }
        }
      } else {
        let match;
        if ((match = odooModules.exec(contents))) {
          const alias = match.groups!.module;
          log(`Found alias ${alias} to ${file} (classic=false)`);
          cache.set(alias, { loc: file, classic: false });
          info.project.refreshDiagnostics();
          return;
        }

        let first = true;
        for (const match of contents.matchAll(odooDefine)) {
          const alias = match.groups!.classic;
          log(`Found alias ${alias} to ${file} (classic=true)`);
          cache.set(alias, { loc: file, classic: true });
          if (!first) {
            log("Merged classic declarations are not fully supported yet");
          }
          first = false;
        }
        if (!first) info.project.refreshDiagnostics()
      }
    }

    const walker = new Walker(ts, pwd);
    for (const file of walker) {
      updateCache(file);
    }

    decorate(info.serverHost, "readFile", (readFile) => {
      return (path, encoding) => {
        let file = readFile(path, encoding);
        if (file) {
          for (const { loc, classic } of cache.values()) {
            if (path == loc && classic) {
              return replaceLast(file, "return", "module.exports=");
            }
          }
        }
        return file;
      };
    });

    decorate(ts, "resolveModuleName", (resolve) => {
      return (name, file, opts, host, cache_, redirected, mode) => {
        if (cache.has(name)) {
          return ts.classicNameResolver(
            cache.get(name)!.loc,
            file,
            opts,
            host,
            cache_,
            redirected
          );
        }
        if (
          name.startsWith("@") &&
          search(host.readFile(file) || "", odooPragma, odooClassicDefine)
        ) {
          const redirect = addonsDir()
            .map(dir => name.replace(odooNewImportPattern, `${dir}/$1/static/src/$2`))
            .find(path => ts.sys.fileExists(path)) || '';
          return ts.classicNameResolver(
            redirect,
            file,
            opts,
            host,
            cache_,
            redirected
          );
        }
        return resolve(name, file, opts, host, cache_, redirected, mode);
      };
    });

    const getCompletionsAtPosition =
      info.languageService.getCompletionsAtPosition;
    info.languageService.getCompletionsAtPosition = (
      file,
      pos,
      opts,
      fopts
    ) => {
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

    ts.sys.watchDirectory!(pwd, updateCache, true, {
      // needed so that ts.sys.readFile doesn't return null for existent file
      synchronousWatchDirectory: true,
    });

    return info.languageService;
  }
  return { create, onConfigurationUpdated };
}

export = init;
