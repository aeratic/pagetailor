// Lets node:test import .jsx files (components, client) by transforming them with esbuild.
import { register } from "node:module";
register(new URL("./jsx-hooks.mjs", import.meta.url));
