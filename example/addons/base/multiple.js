odoo.define("base.one", function (require) {
  return {
    foo: require("base.classic"),
    baz: 123,
  };
});

odoo.define("base.two", function (require) {
  return {
    bar: require("base.classic"),
  };
});
