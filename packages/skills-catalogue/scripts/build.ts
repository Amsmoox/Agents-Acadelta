// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { writeFile } from "node:fs/promises";
import { GENERATED_FILE, readCatalogue, render } from "../src/compile.js";

const sources = await readCatalogue();
await writeFile(GENERATED_FILE, render(sources), "utf8");
console.log(`catalogue: ${sources.length} skills`);
