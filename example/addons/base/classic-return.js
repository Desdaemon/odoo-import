odoo.define("base.classic-return", function (require) {
  const { foo } = require("base.aliased");
  return {
    asd: foo,
    foo() {
      return 123;
    },
  };
});
