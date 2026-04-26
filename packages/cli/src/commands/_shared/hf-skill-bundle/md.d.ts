// Type declaration for esbuild's `text` loader. Imports of `*.md` resolve to
// the file content as a string at build time. See `packages/cli/build.js`
// loader config.
declare module "*.md" {
  const content: string;
  export default content;
}
