import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ObsidianHarness } from "./obsidianHarness";
import { SettingsTabPage } from "./settingsTabPage";
import { SettingsWriteWindow } from "./settingsWriteWindow";

/**
 * End-to-end for the frontmatter-id links feature (ticket
 * `nid_phu0llxhfptse000j66ezrhh3_e`): a note referencing another note's
 * frontmatter `id` through a CONFIGURED field renders as an ordinary link edge,
 * in BOTH directions. `npm test` cannot reach this — the field is configured
 * through the real settings TAB (which has no jsdom coverage), the write rides
 * the debounce window, and the index is driven off the LIVE metadata cache.
 *
 * The two notes are seeded at runtime with explicit `id:` frontmatter (stable-ids
 * keeps an id that is already present), and the referencing note's `deps` points
 * at the other's id. Nothing is written to the source vault — `createNote` seeds
 * the throwaway copy through `vault.create`.
 */

test.describe.configure({ mode: "serial" });

const A_PATH = "idref-a.md";
const B_PATH = "idref-b.md";
const A_ID = "vg-e2e-idref-a";
const B_ID = "vg-e2e-idref-b";
/** The A→B edge id is `source->target`, whichever note is the active MAIN. */
const A_TO_B_EDGE_ID = `${A_PATH}->${B_PATH}`;
/** The accessible name of the id-ref settings row (declared label in `settingsRows.ts`). */
const ID_REF_FIELDS_NAME = "Id-reference fields";

// A references B's id through `deps`; B owns its id and references nothing.
const A_CONTENT = `---\nid: ${A_ID}\ndeps: [${B_ID}]\n---\n\nNote A body.\n`;
const B_CONTENT = `---\nid: ${B_ID}\n---\n\nNote B body.\n`;

let harness: ObsidianHarness;
let page: Page;

test.beforeAll(async () => {
	harness = await ObsidianHarness.launch();
	page = harness.page;

	await harness.createNote(A_PATH, A_CONTENT);
	await harness.createNote(B_PATH, B_CONTENT);

	// Turn the feature on THROUGH the settings tab: type `deps` into the id-ref row
	// and settle the debounced write via the write window (never a sleep).
	const tab = new SettingsTabPage(page);
	const writeWindow = new SettingsWriteWindow(harness, tab);
	await tab.open();
	await tab.typeInto(ID_REF_FIELDS_NAME, "deps");
	await tab.blur(ID_REF_FIELDS_NAME);
	await writeWindow.expectPersisted(
		(globals) => globals.frontmatterLinks.idRefFields,
		"deps",
		"the id-ref fields edit never reached the settings store",
	);
	await tab.close();

	// The incoming direction rides the INCOMING channel, whose depth ships at 0
	// (Obsidian-local-graph parity) — so walk it one hop to observe an incoming
	// id-ref. Orthogonal to the feature: it decides only that incoming links are
	// walked at all, exactly as it would for a wikilink backlink.
	const depths = (await harness.readGlobals()).depths;
	await harness.saveGlobalDepths({ ...depths, linkDepthIn: 1 });

	await harness.openGraphView();
});

test.afterAll(async () => {
	await harness?.close();
});

function edge(edgeId: string) {
	return page.locator(`.vicinity-graph-flow .react-flow__edge[data-id="${edgeId}"]`);
}

test("WHEN the referencing note is active THEN its id-ref renders as an outgoing edge", async () => {
	await harness.openFile(A_PATH);
	await expect(page.locator(`.vicinity-graph-node[data-path="${A_PATH}"]`)).toHaveAttribute("data-tier", "main");
	// B was pulled into A's vicinity purely by the frontmatter id-ref, as an edge A→B.
	await expect(page.locator(`.vicinity-graph-node[data-path="${B_PATH}"]`)).toHaveCount(1);
	await expect(edge(A_TO_B_EDGE_ID)).toHaveCount(1);
});

test("WHEN the referenced note is active THEN the id-ref renders as an incoming edge", async () => {
	await harness.openFile(B_PATH);
	await expect(page.locator(`.vicinity-graph-node[data-path="${B_PATH}"]`)).toHaveAttribute("data-tier", "main");
	// A is the referrer, reached through B's own id — same A→B edge, incoming direction.
	await expect(page.locator(`.vicinity-graph-node[data-path="${A_PATH}"]`)).toHaveCount(1);
	await expect(edge(A_TO_B_EDGE_ID)).toHaveCount(1);
});
