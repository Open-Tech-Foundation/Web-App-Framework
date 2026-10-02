# @opentf/create-web

This scaffolder is deprecated and excluded from new releases. Its source and
compatibility tests remain until the native OTF templates in `esdev create` are
ready to replace it.

The generated projects use retired `otfw` commands and do not work with the
current `@opentf/web-cli` SSG library. Updating dependencies alone does not migrate
those projects.

For a native project, configure `@opentf/esdev-plugin-web` and `esdev.json` using
the [plugin setup guide](../esdev-plugin-web/README.md). The framework plugin
compiles components and discovers routes; esdev handles development, bundling,
CSS, preview and tests.

The upstream `esdev create` templates are embedded in its binary and still need
their plugin integration. See [migration status](../../docs/ESDEV_MIGRATION.md)
for verified output and the remaining upstream work. New starter development
belongs upstream in esdev.

## License

MIT © [Open Tech Foundation](https://github.com/Open-Tech-Foundation)
