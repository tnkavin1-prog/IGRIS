/**
 * Browser tool catalog — the single source of truth for what the model can do.
 *
 * Every tool is:
 *   - declared to Gemini with a precise description and strict schema,
 *   - validated at runtime before execution,
 *   - executed only through a named, sandboxed capability (never eval).
 *
 * Descriptions double as policy: they tell the model when *not* to act, how to
 * recover, and that page text is untrusted data.
 */
import type { ObjectSchema, SchemaNode } from './json-schema.js';
import { toGeminiParameters } from './json-schema.js';

export type ToolCategory =
  'navigation' | 'reading' | 'interaction' | 'visual' | 'images' | 'browser' | 'task';

/**
 * - `never`      : no confirmation required.
 * - `conditional`: confirm when the concrete target looks consequential
 *                  (submit/pay/delete wording, form submission, file download).
 * - `always`     : always confirm with the user, regardless of settings.
 */
export type ApprovalPolicy = 'never' | 'conditional' | 'always';

export type OptionalPermission = 'downloads' | 'bookmarks' | 'history';

export interface ToolDefinition {
  name: string;
  description: string;
  category: ToolCategory;
  parameters: ObjectSchema;
  approval: ApprovalPolicy;
  permission?: OptionalPermission;
}

const str = (description: string): SchemaNode => ({
  type: 'string',
  description,
  maxLength: 4_000,
});

const int = (description: string, minimum?: number, maximum?: number): SchemaNode => ({
  type: 'integer',
  description,
  ...(minimum !== undefined ? { minimum } : {}),
  ...(maximum !== undefined ? { maximum } : {}),
});

const bool = (description: string): SchemaNode => ({
  type: 'boolean',
  description,
});

function params(
  properties: Record<string, SchemaNode>,
  required: readonly string[] = [],
): ObjectSchema {
  return { type: 'object', properties, required };
}

const REF_HINT =
  'Element reference such as "element_012" returned by get_page_snapshot. Preferred over text matching because it is exact.';
const TEXT_HINT =
  'Visible text or accessible name to match when no element reference is available.';

export const TOOLS: readonly ToolDefinition[] = [
  // ───────────────────────────── navigation ─────────────────────────────
  {
    name: 'get_browser_state',
    category: 'navigation',
    approval: 'never',
    description:
      'Get a compact overview of the browser: the active tab, the focused window, and the other open tabs. Start here when you need to know where the user is.',
    parameters: params({}),
  },
  {
    name: 'get_active_tab',
    category: 'navigation',
    approval: 'never',
    description: 'Return the active tab id, title, URL, and loading status.',
    parameters: params({}),
  },
  {
    name: 'list_tabs',
    category: 'navigation',
    approval: 'never',
    description:
      'List open tabs with ids, titles, URLs, and which is active. Use ids with switch_tab.',
    parameters: params({}),
  },
  {
    name: 'open_tab',
    category: 'navigation',
    approval: 'never',
    description:
      'Open an http(s) URL in a new tab and wait for it to load. If the user gave a search phrase instead of a URL, use search_google_images or navigate_to_url with a full URL.',
    parameters: params({ url: str('Absolute http:// or https:// URL.') }, ['url']),
  },
  {
    name: 'switch_tab',
    category: 'navigation',
    approval: 'never',
    description:
      'Focus an existing tab by id, or by a title/URL substring. Returns the tab that became active.',
    parameters: params({
      tabId: int('Tab id from list_tabs.', 0),
      query: str('Case-insensitive title or URL substring.'),
    }),
  },
  {
    name: 'close_tab',
    category: 'navigation',
    approval: 'always',
    description:
      'Close a tab. Always requires the user to approve because unsaved work may be lost.',
    parameters: params({ tabId: int('Tab id; defaults to the active tab.', 0) }),
  },
  {
    name: 'navigate_to_url',
    category: 'navigation',
    approval: 'never',
    description:
      'Navigate the active (or a specified) tab to an absolute http(s) URL and wait for the page to load. Rejects javascript:, data:, file:, and browser-internal schemes.',
    parameters: params(
      {
        url: str('Absolute http:// or https:// URL.'),
        tabId: int('Optional target tab id; defaults to the active tab.', 0),
      },
      ['url'],
    ),
  },
  {
    name: 'go_back',
    category: 'navigation',
    approval: 'never',
    description: 'Go back one entry in the active tab history and wait for the page.',
    parameters: params({}),
  },
  {
    name: 'go_forward',
    category: 'navigation',
    approval: 'never',
    description: 'Go forward one entry in the active tab history and wait for the page.',
    parameters: params({}),
  },
  {
    name: 'reload_tab',
    category: 'navigation',
    approval: 'never',
    description: 'Reload the active tab and wait for the page to load.',
    parameters: params({}),
  },
  {
    name: 'wait_for_navigation',
    category: 'navigation',
    approval: 'never',
    description:
      'Wait until the active tab finishes loading, or until its URL changes. Use after an action that triggers navigation.',
    parameters: params({ timeoutMs: int('Maximum wait in ms (default 15000).', 500, 60_000) }),
  },
  {
    name: 'get_current_url',
    category: 'navigation',
    approval: 'never',
    description: 'Return the URL of the active tab.',
    parameters: params({}),
  },
  {
    name: 'get_page_title',
    category: 'navigation',
    approval: 'never',
    description: 'Return the document title of the active tab.',
    parameters: params({}),
  },

  // ─────────────────────────────── reading ───────────────────────────────
  {
    name: 'get_page_snapshot',
    category: 'reading',
    approval: 'never',
    description:
      'Read the active page semantically: title, URL, headings, a cleaned text excerpt, and a numbered list of visible interactive elements. This is the primary way to find something to click or type into. Call this before any interaction and reuse the returned element references.',
    parameters: params({
      maxTextChars: int('Text budget (default 6000, max 12000).', 500, 12_000),
      maxElements: int('Maximum interactive elements (default 80, max 150).', 10, 150),
    }),
  },
  {
    name: 'read_visible_content',
    category: 'reading',
    approval: 'never',
    description:
      'Read the human-visible text of the page, excluding navigation chrome and invisible nodes. Best for summarising an article.',
    parameters: params({ maxChars: int('Maximum characters (default 8000).', 500, 20_000) }),
  },
  {
    name: 'read_full_page_text',
    category: 'reading',
    approval: 'never',
    description:
      'Read the full document text including off-screen content. Larger and slower than read_visible_content; use only when content seems to be missing.',
    parameters: params({ maxChars: int('Maximum characters (default 20000).', 1_000, 30_000) }),
  },
  {
    name: 'extract_headings',
    category: 'reading',
    approval: 'never',
    description: 'Return the heading outline (h1–h4) of the page.',
    parameters: params({}),
  },
  {
    name: 'extract_links',
    category: 'reading',
    approval: 'never',
    description:
      'Return links with their text and absolute URL. Optionally filter by a query. Useful for finding an official document or a specific result.',
    parameters: params({
      query: str('Optional case-insensitive filter on link text or URL.'),
      limit: int('Maximum links (default 40, max 100).', 1, 100),
    }),
  },
  {
    name: 'extract_images',
    category: 'reading',
    approval: 'never',
    description:
      'Return images on the page with alt text, dimensions, and URL host. Does not describe pixel content; use describe_visible_page for that.',
    parameters: params({ limit: int('Maximum images (default 30, max 60).', 1, 60) }),
  },
  {
    name: 'find_text_on_page',
    category: 'reading',
    approval: 'never',
    description:
      'Locate literal text on the page, scroll the first match into view, and return surrounding context and element references where possible.',
    parameters: params({ query: str('Text to locate (2–200 characters).') }, ['query']),
  },
  {
    name: 'find_element',
    category: 'reading',
    approval: 'never',
    description:
      'Search the DOM for an element by visible text, accessible role, label, or name, and return element references. Use when you need a ref but do not want a full snapshot.',
    parameters: params({
      text: str(TEXT_HINT),
      role: str('ARIA/implicit role, for example button, link, textbox, checkbox.'),
      label: str('Associated <label> text.'),
      name: str('name attribute value.'),
    }),
  },
  {
    name: 'get_element_state',
    category: 'reading',
    approval: 'never',
    description:
      'Return the current state of one element: visibility, enabled/disabled, checked, value (secrets redacted), role, accessible name, and bounding box.',
    parameters: params({ ref: str(REF_HINT) }, ['ref']),
  },
  {
    name: 'get_page_structure',
    category: 'reading',
    approval: 'never',
    description:
      'Return a compact structural outline: landmarks, forms, tables, lists, and counts. Use for unfamiliar or complex pages.',
    parameters: params({}),
  },
  {
    name: 'extract_table_data',
    category: 'reading',
    approval: 'never',
    description:
      'Extract tabular data as rows. Use the tableIndex from get_page_structure when a page has several tables.',
    parameters: params({
      tableIndex: int('Zero-based table index (default 0).', 0, 50),
      maxRows: int('Maximum rows (default 40, max 200).', 1, 200),
    }),
  },

  // ───────────────────────────── interaction ─────────────────────────────
  {
    name: 'click_element',
    category: 'interaction',
    approval: 'conditional',
    description:
      'Click a visible element. Prefer the element reference from get_page_snapshot. The click is verified against the element that actually receives the event; the result reports whether navigation or a DOM change followed.',
    parameters: params({
      ref: str(REF_HINT),
      text: str(TEXT_HINT),
      role: str('Optional role filter when matching by text.'),
      index: int('Zero-based match index when several elements match (default 0).', 0, 50),
    }),
  },
  {
    name: 'hover_element',
    category: 'interaction',
    approval: 'never',
    description:
      'Move the pointer over an element to reveal hover menus or tooltips, then report any newly visible menu items.',
    parameters: params({
      ref: str(REF_HINT),
      text: str(TEXT_HINT),
    }),
  },
  {
    name: 'scroll_page',
    category: 'interaction',
    approval: 'never',
    description:
      'Scroll the page. Returns the new scroll position and whether more content exists below.',
    parameters: params(
      {
        direction: {
          type: 'string',
          enum: ['up', 'down', 'top', 'bottom'],
          description: 'Direction to scroll.',
        },
        amount: int('Pixels for up/down (default 700, max 5000).', 100, 5_000),
      },
      ['direction'],
    ),
  },
  {
    name: 'scroll_to_element',
    category: 'interaction',
    approval: 'never',
    description: 'Scroll a specific element into view and report its position.',
    parameters: params({
      ref: str(REF_HINT),
      text: str(TEXT_HINT),
    }),
  },
  {
    name: 'type_text',
    category: 'interaction',
    approval: 'never',
    description:
      'Type text into a text field. Provide a ref or a label/placeholder. Dispatches real input and change events so React-controlled fields update. Password and one-time-code fields are refused.',
    parameters: params(
      {
        text: str('Text to enter.'),
        ref: str(REF_HINT),
        target: str('Label, placeholder, or accessible name of the field.'),
        clearFirst: bool('Replace existing content instead of appending (default true).'),
      },
      ['text'],
    ),
  },
  {
    name: 'clear_input',
    category: 'interaction',
    approval: 'never',
    description: 'Clear a text field, identified by ref or label.',
    parameters: params({
      ref: str(REF_HINT),
      target: str('Label, placeholder, or accessible name of the field.'),
    }),
  },
  {
    name: 'select_dropdown',
    category: 'interaction',
    approval: 'never',
    description:
      'Choose an option in a native <select> by its visible text or value. Returns the selected option.',
    parameters: params(
      {
        option: str('Visible option text or value.'),
        ref: str(REF_HINT),
        target: str('Label or accessible name of the dropdown.'),
      },
      ['option'],
    ),
  },
  {
    name: 'set_checkbox',
    category: 'interaction',
    approval: 'never',
    description:
      'Set a checkbox or radio button to a desired state. Clicking is skipped when it is already in that state.',
    parameters: params(
      {
        checked: bool('Desired state.'),
        ref: str(REF_HINT),
        target: str('Label or accessible name of the control.'),
      },
      ['checked'],
    ),
  },
  {
    name: 'press_key',
    category: 'interaction',
    approval: 'conditional',
    description:
      'Press a key such as Enter, Escape, Tab, or ArrowDown on the focused element. Enter inside a form may submit it and therefore needs approval.',
    parameters: params(
      {
        key: str('Key name, for example Enter, Escape, Tab, ArrowDown.'),
        ref: str(REF_HINT),
      },
      ['key'],
    ),
  },
  {
    name: 'focus_element',
    category: 'interaction',
    approval: 'never',
    description: 'Focus a field or control and report the document.activeElement.',
    parameters: params({
      ref: str(REF_HINT),
      target: str('Label, placeholder, or accessible name.'),
    }),
  },
  {
    name: 'wait_for_element',
    category: 'interaction',
    approval: 'never',
    description:
      'Wait for an element to become visible. Use after an action that loads content dynamically. Bounded by a timeout; never polls forever.',
    parameters: params(
      {
        target: str('Visible text, label, or role name to wait for.'),
        timeoutMs: int('Maximum wait (default 8000, max 20000).', 500, 20_000),
      },
      ['target'],
    ),
  },
  {
    name: 'wait_for_text',
    category: 'interaction',
    approval: 'never',
    description: 'Wait until specific text appears anywhere in the visible page.',
    parameters: params(
      {
        text: str('Text to wait for.'),
        timeoutMs: int('Maximum wait (default 8000, max 20000).', 500, 20_000),
      },
      ['text'],
    ),
  },
  {
    name: 'submit_form',
    category: 'interaction',
    approval: 'always',
    description:
      'Submit the form containing the referenced element. Always requires explicit user confirmation because submission is consequential. Prefer asking the user to review the filled form first.',
    parameters: params({ ref: str(REF_HINT), target: str('Label of a field inside the form.') }),
  },

  // ─────────────────────────────── visual ───────────────────────────────
  {
    name: 'capture_viewport',
    category: 'visual',
    approval: 'never',
    description:
      'Capture the visible tab as an image and attach it to the live session so you can see the page. Returns a screenshotId used by click_visual_target.',
    parameters: params({}),
  },
  {
    name: 'describe_visible_page',
    category: 'visual',
    approval: 'never',
    description:
      'Attach a fresh screenshot of the visible tab to the conversation and ask you to describe what is actually rendered. Use when DOM semantics are insufficient (canvas apps, image content, layout confusion).',
    parameters: params({}),
  },
  {
    name: 'click_visual_target',
    category: 'visual',
    approval: 'always',
    description:
      'Click at pixel coordinates in the most recent screenshot. Requires the screenshotId returned by capture_viewport; rejected if the page changed since capture. Prefer click_element whenever a DOM element exists.',
    parameters: params(
      {
        screenshotId: str('The id returned by capture_viewport.'),
        x: int('X coordinate in screenshot pixels.', 0, 20_000),
        y: int('Y coordinate in screenshot pixels.', 0, 20_000),
      },
      ['screenshotId', 'x', 'y'],
    ),
  },
  {
    name: 'compare_page_states',
    category: 'visual',
    approval: 'never',
    description:
      'Report what changed since a previous state token: URL, title, text length, element count, scroll position. Use to verify that an action had an effect.',
    parameters: params({
      stateToken: str(
        'Token returned by an earlier tool call. Omit to capture the current state only.',
      ),
    }),
  },

  // ─────────────────────────────── images ───────────────────────────────
  {
    name: 'search_google_images',
    category: 'images',
    approval: 'never',
    description:
      'Open Google Images for a query in a new tab and return the result page state. After it loads, use get_page_snapshot and click_element on a result.',
    parameters: params({ query: str('Image search query.') }, ['query']),
  },
  {
    name: 'open_image_result',
    category: 'images',
    approval: 'conditional',
    description:
      'Open the Nth image result on the current Google Images page. Returns the resulting page so you can verify it.',
    parameters: params({ index: int('Zero-based result index (default 0).', 0, 60) }),
  },

  // ────────────────────────────── browser ───────────────────────────────
  {
    name: 'search_bookmarks',
    category: 'browser',
    approval: 'never',
    permission: 'bookmarks',
    description:
      'Search Chrome bookmarks by title or URL. Requires the optional bookmarks permission.',
    parameters: params({ query: str('Search text.') }, ['query']),
  },
  {
    name: 'search_history',
    category: 'browser',
    approval: 'never',
    permission: 'history',
    description:
      'Search the last 90 days of Chrome history. Requires the optional history permission. Use only when the user asks about their own browsing.',
    parameters: params(
      {
        query: str('Search text.'),
        maxResults: int('Maximum results (default 10, max 30).', 1, 30),
      },
      ['query'],
    ),
  },
  {
    name: 'list_downloads',
    category: 'browser',
    approval: 'never',
    permission: 'downloads',
    description:
      'List recent Chrome downloads with state and size. Requires the optional downloads permission.',
    parameters: params({
      query: str('Optional filename filter.'),
      maxResults: int('Maximum results (default 10, max 30).', 1, 30),
    }),
  },
  {
    name: 'download_link',
    category: 'browser',
    approval: 'always',
    permission: 'downloads',
    description:
      'Start a download from a link URL or a link element reference. Always requires explicit approval and reports the final download state. Verify the file type and host before proposing it.',
    parameters: params({
      url: str('Absolute http(s) URL of the file.'),
      ref: str('Reference to a link element on the page.'),
    }),
  },
  {
    name: 'cancel_download',
    category: 'browser',
    approval: 'always',
    permission: 'downloads',
    description: 'Cancel an in-progress download by id.',
    parameters: params({ downloadId: int('Download id from list_downloads.', 0) }, ['downloadId']),
  },
  {
    name: 'set_zoom',
    category: 'browser',
    approval: 'never',
    description: 'Set the zoom level of the active tab between 50% and 200%.',
    parameters: params({ percent: int('Zoom percentage.', 50, 200) }, ['percent']),
  },

  // ──────────────────────────────── tasks ───────────────────────────────
  {
    name: 'find_official_document',
    category: 'task',
    approval: 'never',
    description:
      'Scan the current page for links that look like official documents (PDF/DOC notices, notifications, recruitment, circulars). Returns ranked candidates with URL and surrounding text. Does not download anything.',
    parameters: params(
      {
        keywords: str(
          'Space-separated keywords that must be relevant, for example "assistant grade 2 notification".',
        ),
        limit: int('Maximum candidates (default 10, max 25).', 1, 25),
      },
      ['keywords'],
    ),
  },
  {
    name: 'download_verified_document',
    category: 'task',
    approval: 'always',
    permission: 'downloads',
    description:
      'Find a document link matching keywords, verify that its text and URL are relevant, then download it after approval. Reports the verified download state.',
    parameters: params(
      {
        keywords: str('Keywords identifying the document.'),
        url: str('Explicit document URL, if already known.'),
        ref: str('Reference to the document link, if known.'),
      },
      ['keywords'],
    ),
  },
  {
    name: 'summarize_webpage',
    category: 'task',
    approval: 'never',
    description:
      'Return a structured dossier of the page (title, headings, key paragraphs, links, tables) tuned for summarisation. Use before summarising long pages so the text budget is spent well.',
    parameters: params({
      focus: str('Optional topic to prioritise in the excerpt.'),
      maxChars: int('Text budget (default 10000).', 1_000, 20_000),
    }),
  },
];

export type ToolName = (typeof TOOLS)[number]['name'];

export const TOOL_BY_NAME: ReadonlyMap<string, ToolDefinition> = new Map(
  TOOLS.map((tool) => [tool.name, tool]),
);

export function isToolName(value: string): value is ToolName {
  return TOOL_BY_NAME.has(value);
}

/** Gemini `functionDeclarations` payload, generated from the catalog. */
export function buildFunctionDeclarations(): Array<Record<string, unknown>> {
  return TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    behavior: 'NON_BLOCKING',
    parameters: toGeminiParameters(tool.parameters),
  }));
}
