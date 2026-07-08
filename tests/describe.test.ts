import { describe, it, expect } from "vitest";
import { describeEvent, eventCommand, eventSearchText } from "../src/web/lib/describe";
import type { NormalizedAgentEvent } from "../src/core/types";

const ev = (over: Partial<NormalizedAgentEvent>): NormalizedAgentEvent => ({
  id: "e1",
  agent: "claude-code",
  source: "hook",
  type: "post_tool_use",
  sessionId: "s1",
  timestamp: "2026-07-04T00:00:00Z",
  receivedAt: "2026-07-04T00:00:00Z",
  title: "Bash complete",
  ...over,
});

describe("describeEvent — what the agent actually did", () => {
  it('recovers the command from a "Bash complete" event (title is useless)', () => {
    const e = ev({
      toolName: "Bash",
      repoPath: "/Users/j/repo",
      input: { value: { command: "rg -n 'foo' src\nls -la" }, redactions: [] },
    });
    // first line carries the intent; the title never does
    expect(describeEvent(e).what).toBe("rg -n 'foo' src");
    expect(describeEvent(e).repo).toBe("repo");
    // the FULL command stays available, untruncated and multi-line
    expect(eventCommand(e)).toBe("rg -n 'foo' src\nls -la");
  });

  it("makes the touched file repo-relative", () => {
    const e = ev({
      repoPath: "/Users/j/repo",
      links: { files: ["/Users/j/repo/src/app.ts"] },
    });
    const d = describeEvent(e);
    expect(d.file).toBe("src/app.ts");
    expect(d.what).toBe("src/app.ts"); // no command → the file is what happened
  });

  it("falls back to the title when there is no command or file", () => {
    expect(describeEvent(ev({ title: "Session started", type: "session_start" })).what).toBe("Session started");
  });

  it("search text covers command, repo, file, tool and type", () => {
    const e = ev({
      toolName: "Bash",
      repoPath: "/Users/j/myrepo",
      links: { files: ["/Users/j/myrepo/src/app.ts"] },
      input: { value: { command: "npm test" } , redactions: [] },
    });
    const hay = eventSearchText(e);
    for (const needle of ["npm test", "myrepo", "src/app.ts", "bash", "post_tool_use"]) {
      expect(hay, needle).toContain(needle);
    }
  });

  // Recall, not precision. 44 real `git commit` events were unsearchable because
  // the term sat after a newline and the haystack only held the first line.
  it("searches the WHOLE command, not just the line shown in the table", () => {
    const e = ev({
      toolName: "Bash",
      input: { value: { command: 'cd /repo\necho "build"\ngit commit -m "ship it"' }, redactions: [] },
    });
    expect(describeEvent(e).what).toBe("cd /repo"); // display stays one line
    expect(eventSearchText(e)).toContain("git commit"); // search does not
  });

  it("names the action for tools that carry no command and no file", () => {
    // ~13% of real events: WebFetch/WebSearch/eval. Previously all read "<tool> complete".
    const fetched = ev({ toolName: "WebFetch", title: "WebFetch complete", input: { value: { url: "https://example.com/docs" }, redactions: [] } });
    expect(describeEvent(fetched).what).toBe("https://example.com/docs");

    const searched = ev({ toolName: "WebSearch", title: "WebSearch complete", input: { value: { query: "tailwind v4 dark mode" }, redactions: [] } });
    expect(describeEvent(searched).what).toBe("tailwind v4 dark mode");
  });

  it("skips blank and shebang/comment lines when picking what to show", () => {
    const blank = ev({ input: { value: { command: "\ngit commit -m 'urgent'" }, redactions: [] } });
    expect(describeEvent(blank).what).toBe("git commit -m 'urgent'"); // not "Bash complete"

    const shebang = ev({ input: { value: { command: "#!/bin/bash\nnpm run build" }, redactions: [] } });
    expect(describeEvent(shebang).what).toBe("npm run build"); // not "#!/bin/bash"
  });
});
