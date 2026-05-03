import { readFile, writeFile } from 'node:fs/promises';
import { defineConfig } from 'tsup';

const sharedOutExtension = ({ format }: { format: string }) => ({
  js: format === 'cjs' ? '.cjs' : '.js',
});

const USE_CLIENT = '"use client";\n';

// tsup runs the output through rollup's tree-shaker, which strips
// module-level directives. Re-prepend after build so Next.js App Router
// still treats the file as a Client Component boundary.
const prependUseClient = async (files: string[]): Promise<void> => {
  await Promise.all(
    files.map(async (file) => {
      const txt = await readFile(file, 'utf8');
      if (!txt.startsWith('"use client"')) {
        await writeFile(file, USE_CLIENT + txt);
      }
    }),
  );
};

export default defineConfig([
  // Client entry: component + hooks + browser auth helpers.
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    treeshake: true,
    splitting: false,
    external: ['react', 'react-dom'],
    target: 'es2020',
    outExtension: sharedOutExtension,
    onSuccess: async () => {
      await prependUseClient(['dist/index.js', 'dist/index.cjs']);
    },
  },
  // Server entry: token exchange + ID-token verification + discovery.
  // No "use client" directive — intended for Node, edge runtimes, etc.
  {
    entry: { server: 'src/server.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    treeshake: true,
    splitting: false,
    target: 'es2020',
    outExtension: sharedOutExtension,
  },
]);
