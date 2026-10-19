import { setDefaultTimeout } from "bun:test";
import { shallot } from "@dylanebert/shallot/bun";
import { TIMEOUT } from "@dylanebert/shallot/testing";
import { plugin } from "bun";

setDefaultTimeout(TIMEOUT.cheap);
plugin(shallot({ root: import.meta.dir }));
