module.exports = {
  printWidth: 120,
  trailingComma: "all",
  tabWidth: 2,
  overrides: [
    {
      files: ["*.ts", "*.tsx"],
      options: {
        parser: "typescript",
        plugins: ["prettier-plugin-organize-imports"],
      },
    },
    {
      files: ["*.json", "*.code-workspace"],
      options: {
        parser: "json",
      },
    },
  ],
};
