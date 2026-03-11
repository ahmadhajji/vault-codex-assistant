import { describe, expect, it } from "vitest";
import { normalizeThinkingSections, splitAssistantLeadIn } from "./messageSegmentation";

describe("messageSegmentation", () => {
  it("moves process narration before the first concrete result into lead-in", () => {
    const content =
      "I'm treating this as a vault search task. I'll inspect the Obsidian search tooling guidance first, then search the vault for likely cardiology notes using filenames, metadata, and content. rg isn't available here, so I'm falling back to find/grep. Next I'm checking whether the obsidian CLI is installed and then I'll search note names plus frontmatter/content for cardiology-related terms. I have the vault inventory. The obvious cardio candidates are the OME/ACLS/heart-related notes, but I'm checking content and metadata too so I don't miss lecture notes filed under broader titles. I found 10 dedicated cardiology notes in the vault:\n\n- ACLS Easy - OME.md";

    const result = splitAssistantLeadIn(content);

    expect(result.leadIn.length).toBeGreaterThan(0);
    expect(result.finalContent.startsWith("I found 10 dedicated cardiology notes")).toBe(true);
    expect(result.finalContent).toContain("- ACLS Easy - OME.md");
  });

  it("keeps process-only streaming text out of the final answer", () => {
    const content =
      "You want every note in the vault that looks cardiology-related. I'm checking the vault structure and search patterns first so I can return a concrete list rather than guessing from folder names. rg isn't available here, so I'm falling back to the vault-aware tools and plain file search. Next step is to query note names and note contents for cardiology terms instead of relying on folder placement.";

    const result = splitAssistantLeadIn(content);

    expect(result.leadIn.length).toBeGreaterThan(0);
    expect(result.finalContent).toBe("");
  });

  it("deduplicates and normalizes thinking sections", () => {
    const sections = normalizeThinkingSections(
      "- Preparing vault-scoped context\n- Drafting final answer\n- Drafting final answer",
      ["I'm checking the vault structure first."]
    );

    expect(sections).toEqual([
      "Preparing vault-scoped context",
      "Drafting final answer",
      "I'm checking the vault structure first.",
    ]);
  });
});
