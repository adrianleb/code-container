#!/usr/bin/env bun
import { createCLI } from "./cli.ts";

const program = createCLI();
program.parse(process.argv);
