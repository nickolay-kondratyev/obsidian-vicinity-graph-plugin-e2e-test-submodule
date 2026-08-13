import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { EngineDefaults } from "../src/engine";
import type { DepthSettings } from "../src/engine";
import { linkCountBadgeText } from "../src/view/badgeText";
import { FOLDER_RELATION_SECTION_TITLE } from "../src/view/LinkPreviewContent";
import { SETTINGS_GROUPS } from "../src/view/settingsRows";
import { ObsidianHarness } from "./obsidianHarness";
import { SettingsTabPage } from "./settingsTabPage";

/**
 * Release-time e2e for folder-note hierarchy (plan `nid_ri1d36t7hmhu0kr652wny1dmz_e`,
 * ticket `nid_eymj85m7qccbpkoo4qj6b1q6t_e`). The RENDERED proof the engine/view
 * tickets deferred here — only a real Obsidian resolves `[[child-of-jon]]` to a
 * file in a real vault, applies the generated `styles.css` (the dashed-edge rule),
 * and mounts the settings tab (which `npm test` cannot render at all).
 *
 * The named Jon scenario (plan decision 5, "Named required test"):
 *   Jon.md links [[child-of-jon]] (TWICE, so the merged edge shows a count badge —
 *   a single link is badge-less by design, see `linkCountBadgeText`) and is the
 *   sibling-style folder note of Jon/, which holds Jon/child-of-jon.md.
 *   - links-out=1 + descendants=1  → ONE merged edge (solid + badge); flyout shows
 *     BOTH the link occurrences and the folder relation.
 *   - links-out=0 + descendants=1  → the same pair is a PURE hierarchy edge
 *     (dashed, no badge): the link is present but unwalked, and cross-links are
 *     off, so it renders structurally; flyout is the folder-relation explanation.
 *   - ancestors=1 with the CHILD as MAIN → the folder note appears above it.
 * Plus a Kim/Kim.md inside-style folder note, proving the second convention.
 *
 * Serial by design: ONE Obsidian instance; each test sets its own depth GIVEN.
 */

test.describe.configure({ mode: "serial" });

const JON_PATH = "Jon.md";
const CHILD_OF_JON_PATH = "Jon/child-of-jon.md";
/** The parent→child ordered pair is one edge; both channels emit that orientation. */
const JON_EDGE_ID = `${JON_PATH}->${CHILD_OF_JON_PATH}`;
/** Jon.md links its child twice → count 2 → a visible "×2" badge on the merged edge. */
const JON_TO_CHILD_LINK_COUNT = 2;

/** Sibling-style folder note that does NOT link its child — so a descendants edge from
 * it is a GENUINELY pure relation, with zero link occurrences in the flyout. */
const ADA_PATH = "Ada.md";
const CHILD_OF_ADA_PATH = "Ada/child-of-ada.md";
const ADA_EDGE_ID = `${ADA_PATH}->${CHILD_OF_ADA_PATH}`;

const KIM_NOTE_PATH = "Kim/Kim.md";
const CHILD_OF_KIM_PATH = "Kim/child-of-kim.md";

/** Sibling-style folder notes (Jon.md/Ada.md beside their folders) + inside-style (Kim/Kim.md within Kim/). */
const HIERARCHY_FIXTURES: Record<string, string> = {
	[JON_PATH]: `Jon links its child once here [[child-of-jon]].\n\nAnd again here [[child-of-jon]].\n`,
	[CHILD_OF_JON_PATH]: "Child of Jon body.\n",
	[ADA_PATH]: "Ada is a folder note that never links its child.\n",
	[CHILD_OF_ADA_PATH]: "Child of Ada body.\n",
	[KIM_NOTE_PATH]: "Inside-style folder note for the Kim folder.\n",
	[CHILD_OF_KIM_PATH]: "Child of Kim body.\n",
};

const PURE_HIERARCHY_EDGE_CLASS = "vicinity-graph-edge--hierarchy";

let harness: ObsidianHarness;
let page: Page;

test.beforeAll(async () => {
	harness = await ObsidianHarness.launch({ extraFixtures: HIERARCHY_FIXTURES });
	page = harness.page;
	await harness.openGraphView();
});

test.afterAll(async () => {
	await harness?.close();
});

function noteNode(path: string): Locator {
	return page.locator(`.vicinity-graph-node[data-path="${path}"]`);
}

function edge(edgeId: string): Locator {
	return page.locator(`.vicinity-graph-flow .react-flow__edge[data-id="${edgeId}"]`);
}

function jonEdge(): Locator {
	return edge(JON_EDGE_ID);
}

function countBadges(): Locator {
	return page.locator(".vicinity-graph-edge__count-badge");
}

function drawer(): Locator {
	return page.locator(".vicinity-graph-link-preview-drawer");
}

/** The flyout's folder-note explanation section, addressed by its declared title. */
function folderRelationSection(): Locator {
	return drawer().locator(`section[aria-label="${FOLDER_RELATION_SECTION_TITLE}"]`);
}

function rowToggles(): Locator {
	return page.locator("button.vicinity-graph-link-preview__row-toggle");
}

/**
 * Sets the global depth dials to defaults with the given overrides, then rebuilds
 * the open view on `mainPath` — `saveGlobalDepths` writes the store but does NOT
 * fan out (see the harness), and the remount refits so a routed edge path is
 * on-screen for a real pointer click.
 */
async function rebuildWith(mainPath: string, overrides: Partial<DepthSettings>): Promise<void> {
	await harness.saveGlobalDepths({ ...EngineDefaults.depthSettings(), ...overrides });
	await harness.openFile(mainPath);
	await harness.remountGraphView();
	await expect(noteNode(mainPath)).toHaveAttribute("data-tier", "main");
}

/**
 * Clicks the MIDPOINT of an edge's rendered path with a real pointer (a plain
 * locator click aims at the bounding-box centre, which for a routed polyline can
 * sit off the stroke). Copied from `linkPreview.e2e.ts` — the one gesture only a
 * real Obsidian exercises through React Flow's edge click handler.
 */
async function clickEdgePath(edgeId: string): Promise<void> {
	const edgePath = page.locator(
		`.vicinity-graph-flow .react-flow__edge[data-id="${edgeId}"] .react-flow__edge-path`,
	);
	const point = await edgePath.evaluate((el) => {
		const path = el as unknown as SVGGeometryElement;
		const mid = path.getPointAtLength(path.getTotalLength() / 2);
		const ctm = path.getScreenCTM();
		if (ctm === null) {
			throw new Error("e2e: edge path has no screen CTM (detached from the rendered tree?)");
		}
		const screen = mid.matrixTransform(ctm);
		return { x: screen.x, y: screen.y };
	});
	await page.mouse.click(point.x, point.y);
}

/** The declared depth row (label + description), pulled from the ONE row model so this spec never re-types copy. */
function depthRow(field: keyof DepthSettings): { label: string; description: string } {
	for (const block of SETTINGS_GROUPS["depth-defaults"].blocks) {
		for (const row of block.rows) {
			if (row.control.kind === "depth" && row.control.field === field) {
				if (row.description === undefined) {
					throw new Error(`e2e: depth row field=[${field}] carries no description to hover`);
				}
				return { label: row.label, description: row.description };
			}
		}
	}
	throw new Error(`e2e: no depth row declares field=[${field}]`);
}

// --- merged edge: links-out=1 + descendants=1 (the shipped defaults) ----------

test("WHEN Jon both links and owns its child THEN the pair is ONE solid edge with a count badge", async () => {
	await rebuildWith(JON_PATH, { linkDepthOut: 1, descendantDepth: 1 });

	// Both nodes present, the child reachable by link AND by folder relation.
	await expect(noteNode(JON_PATH)).toHaveCount(1);
	await expect(noteNode(CHILD_OF_JON_PATH)).toHaveCount(1);
	// ONE edge for the ordered pair — not one per relation ("collapse, don't multiply").
	await expect(jonEdge()).toHaveCount(1);
	// Merged = solid: it must NOT carry the pure-hierarchy dash class.
	await expect(jonEdge()).not.toHaveClass(new RegExp(PURE_HIERARCHY_EDGE_CLASS));
	// Solid + badge, visually identical to a plain link edge (owner pick D1-a).
	await expect(countBadges()).toHaveCount(1);
	await expect(countBadges()).toHaveText(linkCountBadgeText(JON_TO_CHILD_LINK_COUNT)!);
});

test("WHEN the merged edge is clicked THEN the flyout shows BOTH the link occurrences and the folder relation", async () => {
	await harness.remountGraphView();
	await clickEdgePath(JON_EDGE_ID);

	await expect(drawer()).toBeVisible();
	// Both link occurrences (Jon links its child twice) each get a row.
	await expect(rowToggles()).toHaveCount(JON_TO_CHILD_LINK_COUNT);
	// AND the folder-relation section, naming the folder note and its child.
	await expect(folderRelationSection()).toBeVisible();
	await expect(folderRelationSection()).toContainText("Jon.md is the folder note of Jon/");
	await expect(folderRelationSection()).toContainText("child-of-jon.md is inside that folder");

	await drawer().locator("button.vicinity-graph-link-preview-drawer__close").click();
	await expect(drawer()).toHaveCount(0);
});

// --- pure hierarchy edge: descendants-only budget -----------------------------

test("WHEN the links-out budget is 0 THEN the same pair is a DASHED hierarchy edge with no badge", async () => {
	// The link in Jon.md is still there — it is simply unwalked (links-out=0) and
	// cross-links are off, so the edge renders as a PURE folder relation.
	await rebuildWith(JON_PATH, { linkDepthOut: 0, descendantDepth: 1 });

	await expect(noteNode(CHILD_OF_JON_PATH)).toHaveCount(1);
	await expect(jonEdge()).toHaveCount(1);
	await expect(jonEdge()).toHaveClass(new RegExp(PURE_HIERARCHY_EDGE_CLASS));
	// No count badge for a pure hierarchy relation.
	await expect(countBadges()).toHaveCount(0);
	// The dashed stroke is a CSS rule in the generated styles.css — only a real
	// Obsidian proves it reached the edge path.
	const dash = await jonEdge().locator(".react-flow__edge-path").evaluate((el) => getComputedStyle(el).strokeDasharray);
	expect(dash, "the pure-hierarchy edge path must render dashed").not.toBe("none");
});

test("WHEN a pure hierarchy edge is clicked THEN the flyout explains the folder relation with no link occurrences", async () => {
	// Ada owns its child but never links it, so the occurrence provider (which
	// reads the vault independently of what the walk took) has nothing to report —
	// the folder-relation explanation IS the entire content.
	await rebuildWith(ADA_PATH, { descendantDepth: 1 });
	await expect(edge(ADA_EDGE_ID)).toHaveClass(new RegExp(PURE_HIERARCHY_EDGE_CLASS));

	await clickEdgePath(ADA_EDGE_ID);

	await expect(drawer()).toBeVisible();
	// The "Link occurrences" section shows its designed empty state.
	await expect(rowToggles()).toHaveCount(0);
	await expect(drawer()).toContainText("No link occurrences.");
	await expect(folderRelationSection()).toBeVisible();
	await expect(folderRelationSection()).toContainText("Ada.md is the folder note of Ada/");
	await expect(folderRelationSection()).toContainText("child-of-ada.md is inside that folder");

	await drawer().locator("button.vicinity-graph-link-preview-drawer__close").click();
	await expect(drawer()).toHaveCount(0);
});

// --- ancestors: the folder note appears above the child -----------------------

test("WHEN the CHILD is MAIN at ancestors=1 THEN its sibling-style folder note appears", async () => {
	await rebuildWith(CHILD_OF_JON_PATH, { linkDepthOut: 0, descendantDepth: 0, ancestorDepth: 1 });

	// Jon.md is discovered purely as the folder-note parent, drawn parent→child.
	await expect(noteNode(JON_PATH)).toHaveCount(1);
	await expect(jonEdge()).toHaveCount(1);
	await expect(jonEdge()).toHaveClass(new RegExp(PURE_HIERARCHY_EDGE_CLASS));
});

test("WHEN the child of an INSIDE-style folder note is MAIN at ancestors=1 THEN Kim/Kim.md appears", async () => {
	await rebuildWith(CHILD_OF_KIM_PATH, { linkDepthOut: 0, descendantDepth: 0, ancestorDepth: 1 });

	// Kim/Kim.md is the folder note of Kim/ by the INSIDE convention (no sibling exists).
	await expect(noteNode(KIM_NOTE_PATH)).toHaveCount(1);
});

// --- the four depth rows are rendered, with their hover text, on both surfaces --

test("settings tab: the Descendants and Ancestors rows render under Depth with their descriptions", async () => {
	const settingsTab = new SettingsTabPage(page);
	await settingsTab.open();

	for (const field of ["descendantDepth", "ancestorDepth"] as const) {
		const { label, description } = depthRow(field);
		// The dial itself, named by its declared label (a slider on the tab). Exact,
		// so "Descendants" does not also match "Pinned descendants".
		await expect(settingsTab.root().getByLabel(label, { exact: true })).toHaveAttribute("type", "range");
		// Its descriptive folder-note explanation is the row's hover/description copy.
		await expect(settingsTab.rowHolding(label)).toContainText(description);
	}
	await settingsTab.close();
});

test("controls panel: the Descendants dial carries its hover text AND stepping it changes the graph", async () => {
	// GIVEN descendants=0, so the child is out of the graph; the dashed test above
	// left links-out at 0, so the ONLY way the child returns is the descendants dial.
	await rebuildWith(JON_PATH, { linkDepthOut: 0, descendantDepth: 0 });
	await expect(noteNode(CHILD_OF_JON_PATH)).toHaveCount(0);

	// The panel's ACTIVE-note depth block (`:not` — the pinned block shares the base class).
	const activeDepths = page.locator(".vicinity-graph-depth-controls:not(.vicinity-graph-depth-controls--pinned)");
	await page.locator(".vicinity-graph-toolbar").evaluate((el) => {
		(el as HTMLDetailsElement).open = true;
	});
	const { label, description } = depthRow("descendantDepth");
	const stepper = activeDepths.locator(".vicinity-graph-stepper").filter({ hasText: label });
	// The hover text lives on the stepper's `title`, mirroring the tab's description.
	await expect(stepper).toHaveAttribute("title", description);
	await expect(stepper.locator(".vicinity-graph-stepper__value")).toHaveText("0");

	// WHEN the Descendants dial steps 0 → 1 (fire the real handler; the panel can sit
	// off-viewport headless).
	await stepper
		.getByRole("button", { name: "Increase descendants", exact: true })
		.evaluate((el) => (el as HTMLButtonElement).click());

	// THEN the value moves and the folder-note child joins the graph.
	await expect(stepper.locator(".vicinity-graph-stepper__value")).toHaveText("1");
	await expect(noteNode(CHILD_OF_JON_PATH)).toHaveCount(1);
});
