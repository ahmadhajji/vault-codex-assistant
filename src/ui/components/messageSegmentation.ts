export interface AssistantSegmentation {
  leadIn: string[];
  finalContent: string;
}

const PROCESS_SENTENCE_PATTERN =
  /^(Using\b|Checking\b|Searching\b|Reviewing\b|Scanning\b|Looking\b|Inspecting\b|Verifying\b|Loading\b|Reading\b|Comparing\b|Filtering\b|Narrowing\b|Falling back\b|Treating\b|Interpreting\b|I(?:['’]m| am|['’]ve| have|['’]ll| will)\b|Now I(?:['’]m| am|['’]ll| will)\b|First\b|Next\b|Then\b|The goal\b|Goal:|You (?:want|asked)\b|rg\b|find\/grep\b|the .* unavailable\b|The obvious .* candidates are\b)/i;

const RESULT_CUE_PATTERN =
  /\b(I found\b|Found \d+\b|Here are\b|Here is\b|Results?:|Matches?:|Summary:|The (dedicated|matching|relevant|notes?|results?|cardio)[^.\n]*\b(?:are|is):?)/i;

export function splitLeadInSentences(text: string): string[] {
  if (!text.trim()) {
    return [];
  }

  return text
    .split(/(?<=[.!?])(?:\s+|(?=[A-Z0-9["']))|(?<=:)(?:\s+|(?=[A-Z0-9["'\-*]))/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

export function splitAssistantLeadIn(content: string): AssistantSegmentation {
  const trimmed = content.trim();
  if (!trimmed) {
    return { leadIn: [], finalContent: content };
  }

  const cueMatch = RESULT_CUE_PATTERN.exec(trimmed);
  if (cueMatch && cueMatch.index > 0) {
    const leadInText = trimmed.slice(0, cueMatch.index).trim();
    const finalContent = trimmed.slice(cueMatch.index).trim();
    const leadIn = splitLeadInSentences(leadInText);
    if (leadIn.length > 0) {
      return { leadIn, finalContent };
    }
  }

  const sentences = splitLeadInSentences(trimmed);
  if (sentences.length > 0 && sentences.every((sentence) => PROCESS_SENTENCE_PATTERN.test(sentence))) {
    return { leadIn: sentences, finalContent: "" };
  }

  return { leadIn: [], finalContent: content };
}

export function normalizeThinkingSections(thinking: string | undefined, leadIn: string[]): string[] {
  const sections: string[] = [];

  if (thinking) {
    sections.push(
      ...thinking
        .split("\n")
        .map((line) => line.replace(/^\s*-\s*/, "").trim())
        .filter(Boolean)
    );
  }

  sections.push(...leadIn);

  return Array.from(new Set(sections));
}
