#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";

const BINARY_EXTENSIONS = new Set([
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".obj",
  ".o",
  ".a",
  ".lib",
  ".zip",
  ".tar",
  ".gz",
  ".7z",
  ".rar",
  ".bz2",
  ".xz",
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".bmp",
  ".ico",
  ".webp",
  ".tiff",
  ".mp3",
  ".mp4",
  ".avi",
  ".mov",
  ".wmv",
  ".flv",
  ".mkv",
  ".wav",
  ".ogg",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".class",
  ".jar",
  ".war",
  ".ear",
  ".dex",
  ".apk",
  ".wasm",
  ".pyc",
  ".pyo",
]);

const MAGIC_NUMBERS: Array<{ bytes: Uint8Array; type: string }> = [
  { bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]), type: "ZIP" },
  { bytes: new Uint8Array([0x1f, 0x8b]), type: "GZIP" },
  { bytes: new Uint8Array([0xff, 0xd8, 0xff]), type: "JPEG" },
  {
    bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    type: "PNG",
  },
  { bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]), type: "PDF" },
  { bytes: new Uint8Array([0x4d, 0x5a]), type: "PE/EXE" },
  { bytes: new Uint8Array([0x7f, 0x45, 0x4c, 0x46]), type: "ELF" },
];

async function isBinaryFile(filePath: string): Promise<boolean> {
  try {
    const stats = await fs.promises.stat(filePath);

    // Check file extension first (fastest check)
    const ext = path.extname(filePath).toLowerCase();
    if (BINARY_EXTENSIONS.has(ext)) {
      return true;
    }

    // Empty files are not binary
    if (stats.size === 0) {
      return false;
    }

    let fileHandle: fs.promises.FileHandle | null = null;
    try {
      fileHandle = await fs.promises.open(filePath, "r");

      const sampleSize = Math.min(8192, stats.size);
      const buffer = new Uint8Array(sampleSize);
      const { bytesRead } = await fileHandle.read(buffer, 0, sampleSize, 0);

      for (const { bytes: magic } of MAGIC_NUMBERS) {
        if (bytesRead >= magic.length) {
          let matches = true;
          for (let i = 0; i < magic.length; i++) {
            if (buffer[i] !== magic[i]) {
              matches = false;
              break;
            }
          }
          if (matches) return true;
        }
      }

      for (let i = 0; i < bytesRead; i++) {
        if (buffer[i] === 0) {
          return true;
        }
      }

      return false;
    } finally {
      if (fileHandle) {
        await fileHandle.close();
      }
    }
  } catch {
    return true;
  }
}

const messages = {
  paramMissing: (param: string) =>
    `${param} must be provided and should be non-empty. Re-try with corrected parameters.`,
  fileNotExist: (filePath: string) =>
    `File ${filePath} does not exist. You may want to list files in the target directory to verify the correct filename and path. Verify path or create it first and then re-try.`,
  filePermissionError: (filePath: string) =>
    `File ${filePath} is not readable or writable. Check permissions and re-try.`,
  binaryFileError: (filePath: string) =>
    `File ${filePath} appears to be binary. Cannot perform text operations. Verify you provided correct file path. You may want to list files in the target directory to verify the correct filename and path.`,
  identicalText: `searchText and replacementText are identical, meaning no change is needed. If you intend to modify the file, provide distinct searchText and replacementText and re-try.`,
  noMatchFound: (param: string) =>
    `No match found for ${param}. Try different ${param}. Check if this error message contains suggested parameter values for ${param}. If yes, this array can help you determine the correct value. *It is recommended* to read the file again, especially when no parameter values have been proposed, so that you can re-try with correct parameters.`,
  multipleMatches: (param) =>
    `Multiple matches found for ${param}. To avoid unintended changes, specify a unique ${param}. Check if this error message contains a suggestedParameterValues array. If yes, this array can help you determine what you could have tried to search. Re-read file if needed (strongly recommended to re-read the file when suggestedParameterValues array is empty in this error message). Re-try with correct parameters.`,
  targetPathExists: (targetPath: string) =>
    `Target file ${targetPath} already exists. You may want to list files in the target directory to verify the correct filename and path. Choose a different name or delete the file first. Re-try with correct parameters.`,
  directoryMissing: (dir: string, filePath: string) =>
    `Parent directory '${dir}' for file '${filePath}' does not exist. You may want to list files in the target directory to verify the correct filename and path. If you want the required directories to be created automatically then set createMissingDirectories as true. Re-try with correct parameters.`,
  fileAlreadyExists: (filePath: string) =>
    `File to be created '${filePath}' already exists. You may want to list files in the target directory to verify the correct filename and path.. Provide a valid filePath and Re-try with correct parameters.`,
  unexpectedError: (errMsg: string) =>
    `Error: ${errMsg}. Re-check parameters and Re-try with correct parameters.`,
  success: {
    replaced: (action: string, filePath: string, count: number) =>
      `Successfully ${action} ${count} occurrence${
        count !== 1 ? "s" : ""
      } in ${filePath}.`,
    created: (filePath: string) => `File ${filePath} created successfully.`,
    overwritten: (filePath: string) =>
      `Successfully replaced entire content in ${filePath}.`,
    blockDeleted: (filePath: string) =>
      `Successfully deleted matched block in ${filePath}.`,
    appended: (filePath: string) =>
      `Successfully appended provided text in ${filePath}.`,
    renamed: (oldPath: string, newPath: string) =>
      `Successfully moved or renamed ${oldPath} to ${newPath}.`,
    fileDeleted: (filePath: string) => `Successfully deleted ${filePath}.`,
  },
  descriptions: {
    searchAndActionTool: (
      search: string,
      action: string,
      supportsMultipleMatches: boolean = false
    ) =>
      `Safely and easily search for ${search} in a file${
        action ? ` and ${action} it` : ""
      }. ${
        supportsMultipleMatches
          ? "It Can ${action} single match or all matches. "
          : " "
      }Does not fail due to formatting differences (whitespaces and new lines). Does not require complex diff format or line number type inputs. Provides targeted guidance to correct yourself if the tool fails.`,
    suggestedParamArray: `If tool invocation fails due to incorrect parameters, this array provides suggested parameter values to help you determine tht correct parameter values. If the array is empty, it is highly recommended to read the file again to determine the correct parameter values`,
    fileToBeOperatedOn: (actioned: string, expectToExist: boolean) =>
      `Absolute or relative path to the file to be ${actioned}. ${
        expectToExist
          ? "Fails if the file does not exist"
          : "Fails if the file already exists"
      } .`,
    searchText:
      "Must exist in the file (While searching, formatting mismatches are ignored, for e.g. whitespace and new line differences).",
    actionOnAllMatches: (action: string) =>
      `If true, ${action} all searchText matches. If false, requires exactly one match in the file."`,
  },
};

type MatchSpan = {
  flatStart: number;
  flatEndExclusive: number;
  rawStart: number;
  rawEndExclusive: number;
};

type RawMatch = {
  matchType: "prefix" | "suffix" | "mid" | "combined";
  flatStart: number;
  flatEndExclusive: number; // exclusive
  matchedLen: number;
};

const WHITE_SPACE = /\s/;
const NOT_WHITE_SPACE = /\S/;
const WHITE_SPACE_GLOBAL = /\s+/g;

function buildFlatRawTextHelpers(rawText: string) {
  // Convert string to array of full codepoints (surrogate-safe)
  const rawTextChars = Array.from(rawText);
  const rawLength = rawTextChars.length;

  const flatChars: string[] = [];
  const flatRawToRaw: number[] = [];
  const rawToFlatRaw: number[] = new Array(rawLength);
  let flatIndex = 0;
  let i = 0;

  while (i < rawLength) {
    const char = rawTextChars[i];

    if (WHITE_SPACE.test(char)) {
      while (i < rawLength && WHITE_SPACE.test(rawTextChars[i])) {
        rawToFlatRaw[i] = flatIndex;
        i++;
      }
    } else {
      rawToFlatRaw[i] = flatIndex;
      flatRawToRaw[flatIndex] = i;
      flatChars[flatIndex] = char;
      flatIndex++;
      i++;
    }
  }

  return {
    rawTextChars,
    flatRawText: flatChars.join(""),
    flatRawToRaw,
    rawToFlatRaw,
  };
}

function reconstructRawOffset(
  flatIndex: number,
  flatRawToRaw: number[],
  rawToFlatRaw: number
): number {
  if (flatIndex >= flatRawToRaw.length) return rawToFlatRaw;
  return flatRawToRaw[flatIndex];
}

function reconstructFlatOffset(
  rawIndex: number,
  rawToFlatRaw: number[]
): number {
  if (rawIndex >= rawToFlatRaw.length) return rawToFlatRaw.length;
  return rawToFlatRaw[rawIndex];
}

function rawEndExclusiveToFlatEndExclusive(
  rawEndExclusive: number,
  rawToFlatRaw: number[],
  rawTextCharsLen: number,
  rawFlatTextLen: number
): number {
  if (rawEndExclusive >= rawTextCharsLen) return rawFlatTextLen;
  if (rawEndExclusive === 0) return 0;

  const flat = reconstructFlatOffset(rawEndExclusive - 1, rawToFlatRaw) + 1;
  return Math.max(0, Math.min(rawFlatTextLen, flat));
}

function reconstructRawSpan(
  flatStart: number,
  flatEndExclusive: number,
  flatRawToRaw: number[],
  rawTextCharsLen: number
): { rawStart: number; rawEndExclusive: number } {
  const rawStart = reconstructRawOffset(
    flatStart,
    flatRawToRaw,
    rawTextCharsLen
  );
  const rawEndExclusive =
    flatEndExclusive > 0
      ? reconstructRawOffset(
          flatEndExclusive - 1,
          flatRawToRaw,
          rawTextCharsLen
        ) + 1
      : rawStart;

  return { rawStart, rawEndExclusive };
}

function sliceBySpan(
  rawTextChars: string[],
  { rawStart, rawEndExclusive }: { rawStart: number; rawEndExclusive: number }
) {
  return rawTextChars.slice(rawStart, rawEndExclusive).join("");
}

function replaceBySpan(
  rawTextChars: string[],
  span: { rawStart: number; rawEndExclusive: number },
  replacementText: string
) {
  return (
    rawTextChars.slice(0, span.rawStart).join("") +
    replacementText +
    rawTextChars.slice(span.rawEndExclusive).join("")
  );
}

function normalizeText(text: string) {
  return text.replace(WHITE_SPACE_GLOBAL, "");
}

function expandLeftToTokenBoundary(
  rawIndex: number,
  rawTextChars: string[]
): number {
  let pos = rawIndex;

  while (pos > 0 && WHITE_SPACE.test(rawTextChars[pos - 1])) {
    pos--;
  }

  while (pos > 0 && NOT_WHITE_SPACE.test(rawTextChars[pos - 1])) {
    pos--;
  }

  return pos;
}

function expandRightToTokenBoundary(
  rawIndex: number,
  rawTextChars: string[]
): number {
  let pos = rawIndex;
  const length = rawTextChars.length;

  while (pos < length && WHITE_SPACE.test(rawTextChars[pos])) {
    pos++;
  }

  while (pos < length && NOT_WHITE_SPACE.test(rawTextChars[pos])) {
    pos++;
  }

  return pos;
}

function countNonWsInRange(
  rawStart: number,
  rawEndExclusive: number,
  rawTextChars: string[]
): number {
  let count = 0;
  for (let i = rawStart; i < rawEndExclusive; i++) {
    if (NOT_WHITE_SPACE.test(rawTextChars[i])) {
      count++;
    }
  }
  return count;
}

function findMatchSpans(
  flatRawText: string,
  flatSearchText: string,
  rawTextChars: string[],
  flatRawToRaw: number[],
  rawToFlatRaw: number[],
  maxMatches = 3
): { spans: MatchSpan[]; isExactMatch: boolean } {
  // Handle empty inputs
  if (flatRawText.length === 0) {
    return { spans: [], isExactMatch: false };
  }
  if (flatSearchText.length === 0) {
    return { spans: [], isExactMatch: false };
  }

  const exactMatches: MatchSpan[] = [];
  let searchStart = 0;

  while (searchStart < flatRawText.length && exactMatches.length < maxMatches) {
    const matchIndex = flatRawText.indexOf(flatSearchText, searchStart);
    if (matchIndex === -1) break;

    const flatStart = matchIndex;
    const flatEndExclusive = matchIndex + flatSearchText.length;
    const rawSpan = reconstructRawSpan(
      flatStart,
      flatEndExclusive,
      flatRawToRaw,
      rawTextChars.length
    );

    exactMatches.push({
      flatStart,
      flatEndExclusive,
      rawStart: rawSpan.rawStart,
      rawEndExclusive: rawSpan.rawEndExclusive,
    });

    searchStart = matchIndex + 1;
  }

  if (exactMatches.length > 0) {
    return {
      spans: exactMatches.sort((a, b) => a.flatStart - b.flatStart),
      isExactMatch: true,
    };
  }

  //Try to predict what searchText user might have meant
  const candidates = findPotentialMatches(
    flatRawText,
    flatSearchText,
    rawTextChars,
    flatRawToRaw,
    rawToFlatRaw
  );

  return {
    spans: candidates.map((c) => c),
    isExactMatch: false,
  };
}

function findPotentialMatches(
  flatRawText: string,
  flatSearchText: string,
  rawTextChars: string[],
  flatRawToRaw: number[],
  rawToFlatRaw: number[]
): MatchSpan[] {
  const flatRawTextLen = flatRawText.length;
  const flatSearchTextLen = flatSearchText.length;
  if (flatSearchTextLen === 0 || flatRawTextLen === 0) return [];

  const minMatchLen = computeMinMatchLen(flatSearchTextLen);

  const prefLens = computePrefixMatches(flatSearchText, flatRawText);

  const prefixMatches: RawMatch[] = [];
  for (let i = 0; i < flatRawTextLen; i++) {
    const L = Math.min(prefLens[i], flatSearchTextLen);
    if (L > 0) {
      prefixMatches.push({
        matchType: "prefix",
        flatStart: i,
        flatEndExclusive: i + L,
        matchedLen: L,
      });
    }
  }

  const sufLens = computeSuffixMatches(flatSearchText, flatRawText);
  const suffixMatches: RawMatch[] = [];
  for (let start = 0; start < flatRawTextLen; start++) {
    const L = Math.min(sufLens[start], flatSearchTextLen);
    if (L > 0) {
      suffixMatches.push({
        matchType: "suffix",
        flatStart: start,
        flatEndExclusive: start + L,
        matchedLen: L,
      });
    }
  }

  const sam = SuffixAutomaton.build(flatSearchText);
  const midMatches: RawMatch[] = [];
  let state = 0;
  let len = 0;
  for (let i = 0; i < flatRawTextLen; i++) {
    const c = flatRawText[i];
    if (sam.nodes[state].next.has(c)) {
      state = sam.nodes[state].next.get(c)!;
      len++;
    } else {
      while (state !== -1 && !sam.nodes[state].next.has(c)) {
        state = sam.nodes[state].link;
      }
      if (state === -1) {
        state = 0;
        len = 0;
      } else {
        len = sam.nodes[state].len + 1;
        state = sam.nodes[state].next.get(c)!;
      }
    }

    if (len >= minMatchLen) {
      // Strict mid: reject if it ever occurs as prefix or suffix of the search text
      const isPrefix = sam.nodes[state].minEnd === len - 1;
      const isSuffix = sam.nodes[state].maxEnd === flatSearchTextLen - 1;

      if (!isPrefix && !isSuffix) {
        midMatches.push({
          matchType: "mid",
          flatStart: i - len + 1,
          flatEndExclusive: i + 1,
          matchedLen: len,
        });
      }
    }
  }

  // Early filtering for prefix/suffix (allow half threshold to enable combining)
  const prefixThreshold = Math.max(1, Math.floor(minMatchLen / 2));
  const filteredPrefixes = prefixMatches.filter(
    (m) => m.matchedLen >= prefixThreshold
  );
  const filteredSuffixes = suffixMatches.filter(
    (m) => m.matchedLen >= prefixThreshold
  );

  // Build combined matches (prefix + suffix)
  const combinedMatches: RawMatch[] = [];
  if (filteredPrefixes.length > 0 && filteredSuffixes.length > 0) {
    filteredSuffixes.sort((a, b) => a.flatStart - b.flatStart);
    function lowerBoundSuffix(startPos: number) {
      let lo = 0,
        hi = filteredSuffixes.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (filteredSuffixes[mid].flatStart < startPos) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    }

    for (const pre of filteredPrefixes) {
      const idx = lowerBoundSuffix(pre.flatEndExclusive);
      for (let j = idx; j < filteredSuffixes.length; j++) {
        const suf = filteredSuffixes[j];
        if (suf.flatStart < pre.flatEndExclusive) continue;
        const rawSpan = suf.flatEndExclusive - pre.flatStart;
        if (rawSpan < 0.75 * flatSearchTextLen) continue;
        if (rawSpan > 1.25 * flatSearchTextLen) break;
        const combinedLen = pre.matchedLen + suf.matchedLen;
        if (combinedLen >= minMatchLen) {
          combinedMatches.push({
            matchType: "combined",
            flatStart: pre.flatStart,
            flatEndExclusive: suf.flatEndExclusive,
            matchedLen: combinedLen,
          });
        }
      }
    }
  }

  //Collect all qualified standalone matches (prefix/suffix that meet full threshold)
  const qualifiedPrefixes = filteredPrefixes.filter(
    (m) => m.matchedLen >= minMatchLen
  );
  const qualifiedSuffixes = filteredSuffixes.filter(
    (m) => m.matchedLen >= minMatchLen
  );

  // Determine globally longest matches
  const allCandidatesRaw: RawMatch[] = [
    ...qualifiedPrefixes,
    ...qualifiedSuffixes,
    ...midMatches,
    ...combinedMatches,
  ];

  if (allCandidatesRaw.length === 0) return [];

  const maxLen = Math.max(...allCandidatesRaw.map((m) => m.matchedLen));
  const longestMatches = allCandidatesRaw.filter(
    (m) => m.matchedLen === maxLen
  );

  //Deduplicate by flat span and sort by earliest start
  const seen = new Set<string>();
  const uniqueLongest: RawMatch[] = [];
  for (const m of longestMatches) {
    const key = `${m.flatStart}-${m.flatEndExclusive}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueLongest.push(m);
    }
  }
  uniqueLongest.sort((a, b) => a.flatStart - b.flatStart);

  const candidates: MatchSpan[] = [];
  for (const m of uniqueLongest.slice(0, 3)) {
    let candidate: MatchSpan | null = null;
    switch (m.matchType) {
      case "prefix":
        candidate = createPrefixCandidate(
          m.flatStart,
          flatSearchTextLen,
          rawTextChars,
          flatRawToRaw,
          rawToFlatRaw
        );
        break;
      case "suffix":
        candidate = createSuffixCandidate(
          m.flatEndExclusive,
          flatSearchTextLen,
          rawTextChars,
          flatRawToRaw,
          rawToFlatRaw
        );
        break;
      case "mid":
        candidate = createMidCandidate(
          m.flatStart,
          m.flatEndExclusive,
          flatSearchTextLen,
          rawTextChars,
          flatRawToRaw,
          rawToFlatRaw
        );
        break;
      case "combined":
        candidate = createCombinedCandidate(
          m.flatStart,
          m.flatEndExclusive,
          rawTextChars,
          flatRawToRaw,
          rawToFlatRaw
        );
        break;
    }
    if (candidate) candidates.push(candidate);
  }

  return candidates;
}

function computeMinMatchLen(flatSearchTextLen: number): number {
  if (flatSearchTextLen <= 8) {
    return Math.min(3, flatSearchTextLen); // XS texts
  }

  // For longer texts: scale match from 40% to 80%
  const minPercent = 0.4;
  const maxPercent = 0.8;
  const scaleFactor = Math.min(flatSearchTextLen / 1500, 1); // scale from 0 → 1 as length grows
  const percent = minPercent + (maxPercent - minPercent) * scaleFactor;

  return Math.ceil(flatSearchTextLen * percent);
}

function computeZArray(
  pattern: string,
  text: string,
  reverse: boolean = false
): Int32Array {
  const patternLen = pattern.length,
    textLen = text.length;
  const virtualConcatStrLen = patternLen + 1 + textLen;
  const z = new Int32Array(virtualConcatStrLen);
  let L = 0,
    R = 0;

  const charAt = (idx: number): string | null => {
    if (idx < patternLen)
      return reverse ? pattern[patternLen - 1 - idx] : pattern[idx];
    if (idx === patternLen) return null;
    const textIdx = idx - (patternLen + 1);
    return reverse ? text[textLen - 1 - textIdx] : text[textIdx];
  };

  for (let pos = 1; pos < virtualConcatStrLen; pos++) {
    if (pos <= R) {
      const k = pos - L;
      z[pos] = Math.min(R - pos + 1, z[k]);
    } else {
      z[pos] = 0;
    }
    while (pos + z[pos] < virtualConcatStrLen) {
      const a = charAt(z[pos]);
      const b = charAt(pos + z[pos]);
      if (a === null || b === null || a !== b) break;
      z[pos]++;
    }
    if (pos + z[pos] - 1 > R) {
      L = pos;
      R = pos + z[pos] - 1;
    }
  }

  z[0] = virtualConcatStrLen;
  return z;
}

function computePrefixMatches(pattern: string, text: string): Int32Array {
  const patternLen = pattern.length,
    textLen = text.length;
  const z = computeZArray(pattern, text, false);
  const matches = new Int32Array(textLen);
  const offset = patternLen + 1;

  for (let pos = 0; pos < textLen; pos++) {
    const matchLen = z[offset + pos];
    const matchLenCapped = matchLen > patternLen ? patternLen : matchLen;
    matches[pos] = matchLenCapped;
  }

  return matches;
}

function computeSuffixMatches(pattern: string, text: string): Int32Array {
  const patternLen = pattern.length,
    textLen = text.length;
  const z = computeZArray(pattern, text, true);
  const matches = new Int32Array(textLen);
  const offset = patternLen + 1;

  for (let rpos = 0; rpos < textLen; rpos++) {
    const matchLen = z[offset + rpos];
    const matchLenCapped = matchLen > patternLen ? patternLen : matchLen;
    if (matchLenCapped <= 0) continue;
    const start = textLen - rpos - matchLenCapped;
    if (start >= 0 && start < textLen) {
      if (matches[start] < matchLenCapped) matches[start] = matchLenCapped;
    }
  }

  return matches;
}

// Suffix automation
class SAMNode {
  next: Map<string, number> = new Map();
  link: number = -1;
  len: number = 0;

  // representative end position of the state's longest string
  firstPos: number = -1;

  // aggregate over all end positions in Endpos(state)
  minEnd: number = Number.POSITIVE_INFINITY;
  maxEnd: number = Number.NEGATIVE_INFINITY;

  constructor(len = 0) {
    this.len = len;
  }
}

class SuffixAutomaton {
  nodes: SAMNode[] = [new SAMNode()];
  last = 0;

  addChar(c: string) {
    const cur = this.nodes.length;
    this.nodes.push(new SAMNode(this.nodes[this.last].len + 1));
    this.nodes[cur].firstPos = this.nodes[cur].len - 1;

    // initialize min/max end with the occurrence we just created
    this.nodes[cur].minEnd = this.nodes[cur].firstPos;
    this.nodes[cur].maxEnd = this.nodes[cur].firstPos;

    let p = this.last;
    while (p !== -1 && !this.nodes[p].next.has(c)) {
      this.nodes[p].next.set(c, cur);
      p = this.nodes[p].link;
    }

    if (p === -1) {
      this.nodes[cur].link = 0;
    } else {
      const q = this.nodes[p].next.get(c)!;
      if (this.nodes[p].len + 1 === this.nodes[q].len) {
        this.nodes[cur].link = q;
      } else {
        const clone = this.nodes.length;
        this.nodes.push(new SAMNode(this.nodes[p].len + 1));

        // copy transitions & link
        this.nodes[clone].next = new Map(this.nodes[q].next);
        this.nodes[clone].link = this.nodes[q].link;

        // inherit a valid representative end pos
        this.nodes[clone].firstPos = this.nodes[q].firstPos;

        // init min/max — will be corrected by propagation
        this.nodes[clone].minEnd = this.nodes[q].firstPos;
        this.nodes[clone].maxEnd = this.nodes[q].firstPos;

        while (p !== -1 && this.nodes[p].next.get(c) === q) {
          this.nodes[p].next.set(c, clone);
          p = this.nodes[p].link;
        }

        this.nodes[q].link = clone;
        this.nodes[cur].link = clone;
      }
    }

    this.last = cur;
  }

  static build(s: string): SuffixAutomaton {
    const sam = new SuffixAutomaton();
    for (const ch of s) sam.addChar(ch);

    // ---- Propagate minEnd/maxEnd along suffix links in descending length ----
    const order = [...sam.nodes.keys()].sort(
      (a, b) => sam.nodes[a].len - sam.nodes[b].len
    );
    for (let i = order.length - 1; i >= 1; --i) {
      // skip root at index 0
      const v = order[i];
      const link = sam.nodes[v].link;
      if (link >= 0) {
        sam.nodes[link].minEnd = Math.min(
          sam.nodes[link].minEnd,
          sam.nodes[v].minEnd
        );
        sam.nodes[link].maxEnd = Math.max(
          sam.nodes[link].maxEnd,
          sam.nodes[v].maxEnd
        );
      }
    }

    return sam;
  }
}

function createPrefixCandidate(
  flatStart: number,
  targetLen: number,
  rawTextChars: string[],
  flatRawToRaw: number[],
  rawToFlatRaw: number[]
): MatchSpan | null {
  const rawStart = reconstructRawOffset(
    flatStart,
    flatRawToRaw,
    rawTextChars.length
  );
  if (rawStart >= rawTextChars.length) return null;

  let expandedEndExclusive = expandRightToTokenBoundary(rawStart, rawTextChars);

  while (
    countNonWsInRange(rawStart, expandedEndExclusive, rawTextChars) <
      targetLen &&
    expandedEndExclusive < rawTextChars.length
  ) {
    const nextEndExclusive = expandRightToTokenBoundary(
      expandedEndExclusive + 1,
      rawTextChars
    );
    if (nextEndExclusive <= expandedEndExclusive) break;
    expandedEndExclusive = nextEndExclusive;
  }

  return {
    flatStart: reconstructFlatOffset(rawStart, rawToFlatRaw),
    flatEndExclusive: rawEndExclusiveToFlatEndExclusive(
      expandedEndExclusive,
      rawToFlatRaw,
      rawTextChars.length,
      flatRawToRaw.length
    ),
    rawStart: rawStart,
    rawEndExclusive: expandedEndExclusive,
  };
}

function createSuffixCandidate(
  flatEndExclusive: number,
  targetLen: number,
  rawTextChars: string[],
  flatRawToRaw: number[],
  rawToFlatRaw: number[]
): MatchSpan | null {
  const rawEndExclusive =
    reconstructRawOffset(flatEndExclusive, flatRawToRaw, rawTextChars.length) +
    1;
  if (rawEndExclusive > rawTextChars.length) return null;

  let expandedStart = expandLeftToTokenBoundary(
    Math.max(0, rawEndExclusive - 1),
    rawTextChars
  );

  while (
    countNonWsInRange(expandedStart, rawEndExclusive, rawTextChars) <
      targetLen &&
    expandedStart > 0
  ) {
    const prevStart = expandLeftToTokenBoundary(
      Math.max(0, expandedStart - 1),
      rawTextChars
    );
    if (prevStart >= expandedStart) break;
    expandedStart = prevStart;
  }

  return {
    flatStart: reconstructFlatOffset(expandedStart, rawToFlatRaw),
    flatEndExclusive: rawEndExclusiveToFlatEndExclusive(
      rawEndExclusive,
      rawToFlatRaw,
      rawTextChars.length,
      flatRawToRaw.length
    ),
    rawStart: expandedStart,
    rawEndExclusive,
  };
}

function createCombinedCandidate(
  prefixFlatStart: number,
  suffixFlatEndExclusive: number,
  rawTextChars: string[],
  flatRawToRaw: number[],
  rawToFlatRaw: number[]
): MatchSpan | null {
  if (prefixFlatStart >= flatRawToRaw.length) return null;
  if (suffixFlatEndExclusive - 1 >= flatRawToRaw.length) return null;

  const rawStart = reconstructRawOffset(
    prefixFlatStart,
    flatRawToRaw,
    rawTextChars.length
  );
  const rawEndExclusive =
    reconstructRawOffset(
      suffixFlatEndExclusive - 1,
      flatRawToRaw,
      rawTextChars.length
    ) + 1;

  if (rawStart >= rawTextChars.length || rawEndExclusive > rawTextChars.length)
    return null;

  return {
    flatStart: reconstructFlatOffset(rawStart, rawToFlatRaw),
    flatEndExclusive: rawEndExclusiveToFlatEndExclusive(
      rawEndExclusive,
      rawToFlatRaw,
      rawTextChars.length,
      flatRawToRaw.length
    ),
    rawStart: rawStart,
    rawEndExclusive,
  };
}

function createMidCandidate(
  flatStart: number,
  flatEndExclusive: number,
  targetLen: number,
  rawTextChars: string[],
  flatRawToRaw: number[],
  rawToFlatRaw: number[]
): MatchSpan | null {
  if (flatStart >= flatRawToRaw.length) return null;
  if (flatEndExclusive - 1 >= flatRawToRaw.length) return null;

  const rawStart = reconstructRawOffset(
    flatStart,
    flatRawToRaw,
    rawTextChars.length
  );
  const rawEndExclusive =
    reconstructRawOffset(
      flatEndExclusive - 1,
      flatRawToRaw,
      rawTextChars.length
    ) + 1;

  if (rawStart >= rawTextChars.length || rawEndExclusive > rawTextChars.length)
    return null;

  let expandedStart = expandLeftToTokenBoundary(rawStart, rawTextChars);
  let expandedEndExclusive = expandRightToTokenBoundary(
    rawEndExclusive,
    rawTextChars
  );

  while (
    countNonWsInRange(expandedStart, expandedEndExclusive, rawTextChars) <
    targetLen
  ) {
    const before = countNonWsInRange(
      expandedStart,
      expandedEndExclusive,
      rawTextChars
    );

    if (expandedStart > 0) {
      const newLeft = expandLeftToTokenBoundary(
        Math.max(0, expandedStart - 1),
        rawTextChars
      );
      if (newLeft < expandedStart) expandedStart = newLeft;
    }

    if (expandedEndExclusive < rawTextChars.length) {
      const newRight = expandRightToTokenBoundary(
        expandedEndExclusive + 1,
        rawTextChars
      );
      if (newRight > expandedEndExclusive) expandedEndExclusive = newRight;
    }

    const after = countNonWsInRange(
      expandedStart,
      expandedEndExclusive,
      rawTextChars
    );
    if (after === before) break;
  }

  return {
    flatStart: reconstructFlatOffset(expandedStart, rawToFlatRaw),
    flatEndExclusive: rawEndExclusiveToFlatEndExclusive(
      expandedEndExclusive,
      rawToFlatRaw,
      rawTextChars.length,
      flatRawToRaw.length
    ),
    rawStart: expandedStart,
    rawEndExclusive: expandedEndExclusive,
  };
}

function generateDisambiguationSuggestionsFromSpans(
  spans: MatchSpan[],
  rawTextChars: string[],
  flatRawText: string,
  rawToFlatRaw: number[]
): string[] {
  if (spans.length === 0) return [];

  const slices = spans.map((span) => ({
    span: { ...span },
    originalSpan: { ...span },
  }));

  const nonExpandableSpanIndices = new Set<number>();

  let duplicatesExist: boolean;
  do {
    const flatSlices = slices.map((s) =>
      flatRawText.slice(s.span.flatStart, s.span.flatEndExclusive)
    );

    // Group by content
    const contentGroups = new Map<string, number[]>();
    flatSlices.forEach((content, idx) => {
      if (nonExpandableSpanIndices.has(idx)) return;
      if (!contentGroups.has(content)) {
        contentGroups.set(content, []);
      }
      contentGroups.get(content)!.push(idx);
    });

    const duplicateGroups = Array.from(contentGroups.values()).filter(
      (group) => group.length > 1
    );

    duplicatesExist = duplicateGroups.length > 0;

    for (const group of duplicateGroups) {
      for (const idx of group) {
        const slice = slices[idx];
        const expanded = expandSpanForDisambiguation(
          slice.span,
          rawTextChars,
          rawToFlatRaw
        );
        if (
          expanded.rawStart !== slice.span.rawStart ||
          expanded.rawEndExclusive !== slice.span.rawEndExclusive
        ) {
          slice.span = expanded;
        } else {
          nonExpandableSpanIndices.add(idx);
        }
      }
    }
  } while (duplicatesExist);

  return slices.map((s) => sliceBySpan(rawTextChars, s.span));
}

function expandSpanForDisambiguation(
  span: MatchSpan,
  rawTextChars: string[],
  rawTextToFlat: number[]
): MatchSpan {
  let { rawStart, rawEndExclusive } = span;

  // Try to expand left by one token
  const newStart = expandLeftToTokenBoundary(
    Math.max(0, rawStart - 1),
    rawTextChars
  );
  if (newStart < rawStart) {
    rawStart = newStart;
  }

  // Try to expand right by one token
  const newEndExclusive = expandRightToTokenBoundary(
    Math.min(rawTextChars.length, rawEndExclusive + 1),
    rawTextChars
  );
  if (newEndExclusive > rawEndExclusive) {
    rawEndExclusive = newEndExclusive;
  }

  return {
    flatStart: reconstructFlatOffset(rawStart, rawTextToFlat),
    flatEndExclusive:
      reconstructFlatOffset(Math.max(0, rawEndExclusive - 1), rawTextToFlat) +
      1,
    rawStart,
    rawEndExclusive,
  };
}

async function validateTextFileToEdit(
  filePath: string,
  checkIfBinary: boolean = true
): Promise<{ success: boolean; message?: string }> {
  if (!fs.existsSync(filePath)) {
    return { success: false, message: messages.fileNotExist(filePath) };
  }

  try {
    await fs.promises.access(filePath, fs.constants.R_OK | fs.constants.W_OK);
  } catch {
    return { success: false, message: messages.filePermissionError(filePath) };
  }

  if (checkIfBinary) {
    if (await isBinaryFile(filePath)) {
      return { success: false, message: messages.binaryFileError(filePath) };
    }
  }

  return { success: true };
}

function handleSearchTextMatchIssues(
  spans: MatchSpan[],
  rawTextChars: string[],
  flatRawText: string,
  rawToFlatRaw: number[],
  message: (p: string) => string,
  searchPropName: string
): {
  success: boolean;
  result: {
    message: string;
    SuggestedParameterValues: {
      [searchPropName]: string;
    }[];
  };
} {
  return {
    success: false,
    result: {
      message: message(searchPropName),
      SuggestedParameterValues: generateDisambiguationSuggestionsFromSpans(
        spans,
        rawTextChars,
        flatRawText,
        rawToFlatRaw
      ).map((s) => ({ [searchPropName]: s })),
    },
  };
}

async function searchTextAndReplace(
  p: { filePath?: string; searchText?: string; replacementText?: string },
  actionAllMatches: boolean,
  validateReplaceText: boolean
): Promise<{
  success: boolean;
  result: {
    message: string;
    SuggestedParameterValues?: { searchText?: string }[];
  };
}> {
  const fileValidation = await validateTextFileToEdit(p.filePath);
  if (!fileValidation.success) {
    return { success: false, result: { message: fileValidation.message! } };
  }

  if (validateReplaceText) {
    if (p.searchText === p.replacementText)
      return { success: false, result: { message: messages.identicalText } };
  }

  const rawText = await fs.promises.readFile(p.filePath, "utf-8");
  const { rawTextChars, flatRawText, flatRawToRaw, rawToFlatRaw } =
    buildFlatRawTextHelpers(rawText);

  const { spans, isExactMatch } = findMatchSpans(
    flatRawText,
    normalizeText(p.searchText),
    rawTextChars,
    flatRawToRaw,
    rawToFlatRaw
  );

  if (!isExactMatch || spans.length === 0) {
    return handleSearchTextMatchIssues(
      spans,
      rawTextChars,
      flatRawText,
      rawToFlatRaw,
      messages.noMatchFound,
      "searchText"
    );
  }

  if (!actionAllMatches && spans.length > 1) {
    return handleSearchTextMatchIssues(
      spans,
      rawTextChars,
      flatRawText,
      rawToFlatRaw,
      messages.multipleMatches,
      "searchText"
    );
  }

  let newRawText = rawText;

  for (let i = spans.length - 1; i >= 0; i--) {
    const span = spans[i];
    newRawText = replaceBySpan(rawTextChars, span, p.replacementText);
    const replacementTextChars = Array.from(p.replacementText);
    rawTextChars.splice(
      span.rawStart,
      span.rawEndExclusive - span.rawStart,
      ...replacementTextChars
    );
  }

  await fs.promises.writeFile(p.filePath, newRawText, "utf-8");
  return {
    success: true,
    result: {
      message: messages.success.replaced(
        p.replacementText ? "replaced" : "deleted",
        p.filePath,
        spans.length
      ),
    },
  };
}

const ReplaceMatchingTextParams = {
  filePath: z
    .string()
    .describe(messages.descriptions.fileToBeOperatedOn("edited", true)),
  searchText: z
    .string()
    .describe(
      "Text to search for matching. " + messages.descriptions.searchText
    ),
  replacementText: z
    .string()
    .describe(
      "Text to replace searchText matches with. Should be exactly what you want to write, including formatting"
    ),
  replaceAllOccurrencesOfSearchText: z.coerce
    .boolean()
    .default(false)
    .optional()
    .describe(messages.descriptions.actionOnAllMatches("replaces")),
};

const ReplaceMatchingTextParamsParser = z.object(ReplaceMatchingTextParams);
type ReplaceMatchingTextParamsType = z.infer<
  typeof ReplaceMatchingTextParamsParser
>;

async function replaceMatchingTextImpl(
  params: ReplaceMatchingTextParamsType
): Promise<{
  success: boolean;
  result: {
    message: string;
    SuggestedParameterValues?: { searchText?: string }[];
  };
}> {
  try {
    const p = ReplaceMatchingTextParamsParser.parse(params);
    return await searchTextAndReplace(
      p,
      p.replaceAllOccurrencesOfSearchText,
      true
    );
  } catch (err) {
    return {
      success: false,
      result: { message: messages.unexpectedError((err as Error).message) },
    };
  }
}

const DeleteMatchingTextParams = {
  filePath: z
    .string()
    .describe(messages.descriptions.fileToBeOperatedOn("edited", true)),
  searchText: z
    .string()
    .describe(
      "Text to search for matching. " + messages.descriptions.searchText
    ),
  deleteAllOccurrencesOfSearchText: z.coerce
    .boolean()
    .default(false)
    .optional()
    .describe(messages.descriptions.actionOnAllMatches("deletes")),
};

const DeleteMatchingTextParamsParser = z.object(DeleteMatchingTextParams);
type DeleteMatchingTextParamsType = z.infer<
  typeof DeleteMatchingTextParamsParser
>;

async function deleteMatchingTextImpl(
  params: DeleteMatchingTextParamsType
): Promise<{
  success: boolean;
  result: {
    message: string;
    SuggestedParameterValues?: { searchText?: string }[];
  };
}> {
  try {
    const p = DeleteMatchingTextParamsParser.parse(params);
    return await searchTextAndReplace(
      { ...p, ...{ replacementText: "" } },
      p.deleteAllOccurrencesOfSearchText,
      false
    );
  } catch (err) {
    return {
      success: false,
      result: { message: messages.unexpectedError((err as Error).message) },
    };
  }
}

const CreateFileParams = {
  filePath: z
    .string()
    .describe(messages.descriptions.fileToBeOperatedOn("created", false)),
  fileContent: z
    .string()
    .optional()
    .describe("Initial content to write into the file. Defaults to empty."),
  createMissingDirectories: z
    .boolean()
    .optional()
    .describe("If true, creates missing directories in the file path."),
};

const CreateFileParamsParser = z.object(CreateFileParams);
type CreateFileParamsType = z.infer<typeof CreateFileParamsParser>;

async function createFileImpl(params: CreateFileParamsType) {
  try {
    const p = CreateFileParamsParser.parse(params);

    const dir = path.dirname(p.filePath);

    if (!fs.existsSync(dir)) {
      if (p.createMissingDirectories) {
        fs.mkdirSync(dir, { recursive: true });
      } else {
        return {
          success: false,
          result: { message: messages.directoryMissing(dir, p.filePath) },
        };
      }
    }

    if (fs.existsSync(p.filePath)) {
      return {
        success: false,
        result: {
          message: messages.fileAlreadyExists(p.filePath),
        },
      };
    }

    await fs.promises.writeFile(p.filePath, p.fileContent || "", "utf-8");
    return {
      success: true,
      result: { message: messages.success.created(p.filePath) },
    };
  } catch (err) {
    return {
      success: false,
      result: { message: messages.unexpectedError((err as Error).message) },
    };
  }
}

const OverwriteFileContentParams = {
  filePath: z
    .string()
    .describe(messages.descriptions.fileToBeOperatedOn("edited", true)),
  fileContent: z
    .string()
    .describe(
      "New content to write into the file. Will completely replace existing content."
    ),
};

const OverwriteFileContentParamsParser = z.object(OverwriteFileContentParams);
type OverwriteFileContentParamsType = z.infer<
  typeof OverwriteFileContentParamsParser
>;

async function overwriteFileContentImpl(
  params: OverwriteFileContentParamsType
) {
  try {
    const p = OverwriteFileContentParamsParser.parse(params);

    const fileValidation = await validateTextFileToEdit(p.filePath);
    if (!fileValidation.success) {
      return { success: false, result: { message: fileValidation.message! } };
    }

    await fs.promises.writeFile(p.filePath, p.fileContent, "utf-8");
    return {
      success: true,
      result: { message: messages.success.overwritten(p.filePath) },
    };
  } catch (err) {
    return {
      success: false,
      result: { message: messages.unexpectedError((err as Error).message) },
    };
  }
}

const AppendTextToFileParams = {
  filePath: z
    .string()
    .describe(messages.descriptions.fileToBeOperatedOn("edited", true)),
  appendText: z.string().describe("Text to append to the end of the file."),
  addNewLineBeforeAppending: z.coerce
    .boolean()
    .default(true)
    .optional()
    .describe(
      "If true, ensures a newline is added before appending the provided text. If file is already ending with a newLine this flag is ignored."
    ),
};

const AppendTextToFileParamsParser = z.object(AppendTextToFileParams);
type AppendTextToFileParamsType = z.infer<typeof AppendTextToFileParamsParser>;

async function appendTextToFileImpl(params: AppendTextToFileParamsType) {
  try {
    const p = AppendTextToFileParamsParser.parse(params);

    const fileValidation = await validateTextFileToEdit(p.filePath);
    if (!fileValidation.success) {
      return { success: false, result: { message: fileValidation.message! } };
    }

    let content = await fs.promises.readFile(p.filePath, "utf-8");

    if (p.addNewLineBeforeAppending) {
      const lineEndingMatch = content.match(/\r\n|\n|\r/);
      const lineEnding = lineEndingMatch ? lineEndingMatch[0] : "\n";
      if (!content.endsWith(lineEnding)) content += lineEnding;
    }

    content += p.appendText;

    await fs.promises.writeFile(p.filePath, content, "utf-8");
    return {
      success: true,
      result: { message: messages.success.appended(p.filePath) },
    };
  } catch (err) {
    return {
      success: false,
      result: { message: messages.unexpectedError((err as Error).message) },
    };
  }
}

const InsertTextParams = {
  filePath: z
    .string()
    .describe(messages.descriptions.fileToBeOperatedOn("edited", true)),
  textToBeInserted: z
    .string()
    .describe("Text to insert relative to the anchorText match."),
  anchorText: z
    .string()
    .describe(
      "Anchor text to search. " +
        messages.descriptions.searchText +
        " Provided textToBeInserted is inserted *relative* to this match. Requires exactly one anchorText match in the file."
    ),
  positionRelativeToAnchorText: z
    .enum(["before", "after"])
    .describe(
      "Whether to insert the text before or after the matched anchorText."
    ),

  anchorBlockStartMarker: z
    .string()
    .optional()
    .describe(
      "If provided, restricts anchorText to after the start of this marker. Match(es) must exist in the file. First matched anchorBlockStartMarker is used."
    ),

  anchorBlockEndMarker: z
    .string()
    .optional()
    .describe(
      "If provided, restricts anchorText to before the end of this marker. Match(es) must exist in the file. Last matched anchorBlockEndMarker is used."
    ),
  addNewLine: z
    .boolean()
    .default(false)
    .optional()
    .describe(
      "If true, ensures a newline separation between the anchorText and textToBeInserted."
    ),
};

const InsertTextParamsParser = z.object(InsertTextParams);
type InsertTextParamsType = z.infer<typeof InsertTextParamsParser>;

async function insertTextImpl(params: InsertTextParamsType): Promise<{
  success: boolean;
  result: {
    message: string;
    SuggestedParameterValues?: {
      anchorText?: string;
      anchorBlockStartMarker?: string;
      anchorBlockEndMarker?: string;
    }[];
  };
}> {
  try {
    const p = InsertTextParamsParser.parse(params);

    const fileValidation = await validateTextFileToEdit(p.filePath);
    if (!fileValidation.success) {
      return { success: false, result: { message: fileValidation.message! } };
    }

    const rawText = await fs.promises.readFile(p.filePath, "utf-8");
    const { rawTextChars, flatRawText, flatRawToRaw, rawToFlatRaw } =
      buildFlatRawTextHelpers(rawText);

    let blockStartSpan: MatchSpan = null;
    if (p.anchorBlockStartMarker) {
      const startMatches = findMatchSpans(
        flatRawText,
        normalizeText(p.anchorBlockStartMarker),
        rawTextChars,
        flatRawToRaw,
        rawToFlatRaw
      );

      if (!startMatches.isExactMatch || startMatches.spans.length === 0) {
        return handleSearchTextMatchIssues(
          startMatches.spans,
          rawTextChars,
          flatRawText,
          rawToFlatRaw,
          messages.noMatchFound,
          "anchorBlockStartMarker"
        );
      }

      blockStartSpan = startMatches.spans[0];
    }

    let blockEndSpan: MatchSpan = null;
    if (p.anchorBlockEndMarker) {
      const endMatches = findMatchSpans(
        flatRawText,
        normalizeText(p.anchorBlockEndMarker),
        rawTextChars,
        flatRawToRaw,
        rawToFlatRaw
      );

      const validEndSpans = endMatches.spans.filter(
        (e) => e.rawStart >= blockStartSpan.rawEndExclusive
      );

      if (!endMatches.isExactMatch || validEndSpans.length === 0) {
        return handleSearchTextMatchIssues(
          endMatches.spans,
          rawTextChars,
          flatRawText,
          rawToFlatRaw,
          messages.noMatchFound,
          "anchorBlockEndMarker"
        );
      }

      blockEndSpan = validEndSpans[validEndSpans.length - 1];
    }

    const allSearchMatches = findMatchSpans(
      flatRawText,
      normalizeText(p.anchorText),
      rawTextChars,
      flatRawToRaw,
      rawToFlatRaw
    );

    let blockStartOffset = blockStartSpan ? blockStartSpan.rawStart : 0;
    let blockEndOffset = blockEndSpan
      ? blockEndSpan.rawEndExclusive
      : rawTextChars.length;
    const searchMatchesInBlock = allSearchMatches.spans.filter(
      (s) =>
        s.rawStart >= blockStartOffset && s.rawEndExclusive <= blockEndOffset
    );

    if (!allSearchMatches.isExactMatch || searchMatchesInBlock.length === 0) {
      return handleSearchTextMatchIssues(
        searchMatchesInBlock,
        rawTextChars,
        flatRawText,
        rawToFlatRaw,
        messages.noMatchFound,
        "anchorText"
      );
    }

    if (searchMatchesInBlock.length > 1) {
      return handleSearchTextMatchIssues(
        searchMatchesInBlock,
        rawTextChars,
        flatRawText,
        rawToFlatRaw,
        messages.multipleMatches,
        "anchorText"
      );
    }

    const span = searchMatchesInBlock[0];
    const insertionPoint =
      p.positionRelativeToAnchorText === "before"
        ? span.rawStart
        : span.rawEndExclusive;

    let textToInsert = p.textToBeInserted;
    if (p.addNewLine) {
      const lineEndingMatch = rawText.match(/\r\n|\n|\r/);
      const lineEnding = lineEndingMatch ? lineEndingMatch[0] : "\n";
      textToInsert =
        p.positionRelativeToAnchorText === "before"
          ? textToInsert + lineEnding
          : lineEnding + textToInsert;
    }

    const newRawText = replaceBySpan(
      rawTextChars,
      { rawStart: insertionPoint, rawEndExclusive: insertionPoint },
      textToInsert
    );

    await fs.promises.writeFile(p.filePath, newRawText, "utf-8");
    return {
      success: true,
      result: {
        message: `Successfully inserted provided text ${p.positionRelativeToAnchorText} the matched anchorText in ${p.filePath}.`,
      },
    };
  } catch (err) {
    return {
      success: false,
      result: { message: messages.unexpectedError((err as Error).message) },
    };
  }
}

const MoveTextParams = {
  filePath: z
    .string()
    .describe(messages.descriptions.fileToBeOperatedOn("edited", true)),
  textToBeMoved: z
    .string()
    .describe(
      "Text to be found and moved relative to the anchorText match." +
        messages.descriptions.searchText
    ),
  anchorText: z
    .string()
    .describe(
      "Anchor text to search. " +
        messages.descriptions.searchText +
        " Provided textToBeMoved is placed *relative* to this match. Requires exactly one anchorText match in the file."
    ),
  positionRelativeToAnchorText: z
    .enum(["before", "after"])
    .describe(
      "Whether to move the text before or after the matched anchorText."
    ),

  anchorBlockStartMarker: z
    .string()
    .optional()
    .describe(
      "If provided, restricts anchorText to after the start of this marker. Match(es) must exist in the file. First matched anchorBlockStartMarker is used."
    ),

  anchorBlockEndMarker: z
    .string()
    .optional()
    .describe(
      "If provided, restricts anchorText to before the end of this marker. Match(es) must exist in the file. Last matched anchorBlockEndMarker is used."
    ),
};

const MoveTextParamsParser = z.object(MoveTextParams);
type MoveTextParamsType = z.infer<typeof MoveTextParamsParser>;

async function moveTextImpl(params: MoveTextParamsType): Promise<{
  success: boolean;
  result: {
    message: string;
    SuggestedParameterValues?: {
      textToBeMoved?: string;
      searchText?: string;
      anchorBlockStartMarker?: string;
      anchorBlockEndMarker?: string;
    }[];
  };
}> {
  try {
    const p = MoveTextParamsParser.parse(params);

    const fileValidation = await validateTextFileToEdit(p.filePath);
    if (!fileValidation.success) {
      return { success: false, result: { message: fileValidation.message! } };
    }

    const rawText = await fs.promises.readFile(p.filePath, "utf-8");
    const { rawTextChars, flatRawText, flatRawToRaw, rawToFlatRaw } =
      buildFlatRawTextHelpers(rawText);

    const lineEndingMatch = rawText.match(/\r\n|\n|\r/);
    const lineEnding = lineEndingMatch ? lineEndingMatch[0] : "\n";

    const allMoveMatches = findMatchSpans(
      flatRawText,
      normalizeText(p.textToBeMoved),
      rawTextChars,
      flatRawToRaw,
      rawToFlatRaw
    );
    if (!allMoveMatches.isExactMatch || allMoveMatches.spans.length === 0) {
      return handleSearchTextMatchIssues(
        allMoveMatches.spans,
        rawTextChars,
        flatRawText,
        rawToFlatRaw,
        messages.noMatchFound,
        "textToBeMoved"
      );
    }
    if (allMoveMatches.spans.length > 1) {
      return handleSearchTextMatchIssues(
        allMoveMatches.spans,
        rawTextChars,
        flatRawText,
        rawToFlatRaw,
        messages.multipleMatches,
        "textToBeMoved"
      );
    }

    const moveSpan = allMoveMatches.spans[0];

    let blockStartSpan: MatchSpan | null = null;
    if (p.anchorBlockStartMarker) {
      const startMatches = findMatchSpans(
        flatRawText,
        normalizeText(p.anchorBlockStartMarker),
        rawTextChars,
        flatRawToRaw,
        rawToFlatRaw
      );
      if (!startMatches.isExactMatch || startMatches.spans.length === 0)
        return handleSearchTextMatchIssues(
          startMatches.spans,
          rawTextChars,
          flatRawText,
          rawToFlatRaw,
          messages.noMatchFound,
          "anchorBlockStartMarker"
        );
      blockStartSpan = startMatches.spans[0];
    }

    let blockEndSpan: MatchSpan | null = null;
    if (p.anchorBlockEndMarker) {
      const endMatches = findMatchSpans(
        flatRawText,
        normalizeText(p.anchorBlockEndMarker),
        rawTextChars,
        flatRawToRaw,
        rawToFlatRaw
      );
      const validEndSpans = endMatches.spans.filter(
        (e) => !blockStartSpan || e.rawStart >= blockStartSpan.rawEndExclusive
      );
      if (!endMatches.isExactMatch || validEndSpans.length === 0)
        return handleSearchTextMatchIssues(
          endMatches.spans,
          rawTextChars,
          flatRawText,
          rawToFlatRaw,
          messages.noMatchFound,
          "anchorBlockEndMarker"
        );
      blockEndSpan = validEndSpans[validEndSpans.length - 1];
    }

    const allAnchorMatches = findMatchSpans(
      flatRawText,
      normalizeText(p.anchorText),
      rawTextChars,
      flatRawToRaw,
      rawToFlatRaw
    );
    const blockStartOffset = blockStartSpan ? blockStartSpan.rawStart : 0;
    const blockEndOffset = blockEndSpan
      ? blockEndSpan.rawEndExclusive
      : rawTextChars.length;
    const anchorMatchesInBlock = allAnchorMatches.spans.filter(
      (s) =>
        s.rawStart >= blockStartOffset && s.rawEndExclusive <= blockEndOffset
    );

    if (!allAnchorMatches.isExactMatch || anchorMatchesInBlock.length === 0)
      return handleSearchTextMatchIssues(
        anchorMatchesInBlock,
        rawTextChars,
        flatRawText,
        rawToFlatRaw,
        messages.noMatchFound,
        "anchorText"
      );
    if (anchorMatchesInBlock.length > 1)
      return handleSearchTextMatchIssues(
        anchorMatchesInBlock,
        rawTextChars,
        flatRawText,
        rawToFlatRaw,
        messages.multipleMatches,
        "anchorText"
      );

    const anchorSpan = anchorMatchesInBlock[0];

    const moveSpanLineBoundaryStartPos = findLineBoundaryToLeft(
      rawTextChars,
      moveSpan
    );
    const moveSpanLineBoundaryEndPos = findLineBoundaryToRight(
      rawTextChars,
      moveSpan
    );
    const anchorSpanLineBoundaryStartPos = findLineBoundaryToLeft(
      rawTextChars,
      anchorSpan
    );
    const anchorSpanLineBoundaryEndPos = findLineBoundaryToRight(
      rawTextChars,
      anchorSpan
    );

    const isAnchorTextAtLineBoundary =
      p.positionRelativeToAnchorText === "before"
        ? anchorSpanLineBoundaryStartPos >= 0
        : anchorSpanLineBoundaryEndPos >= 0;

    const isLineBoundaryMove =
      moveSpanLineBoundaryStartPos >= 0 &&
      moveSpanLineBoundaryEndPos >= 0 &&
      isAnchorTextAtLineBoundary;

    let deletionSpan = {
      rawStart: isLineBoundaryMove
        ? moveSpanLineBoundaryStartPos
        : moveSpan.rawStart,
      rawEndExclusive: isLineBoundaryMove
        ? expandEndLineBoundaryToIncludeTrailingNewLine(rawTextChars, moveSpanLineBoundaryEndPos)
        : moveSpan.rawEndExclusive,
    };

    let insertionPoint =
      p.positionRelativeToAnchorText === "before"
        ? isLineBoundaryMove
          ? anchorSpanLineBoundaryStartPos
          : anchorSpan.rawStart
        : isLineBoundaryMove
        ? anchorSpanLineBoundaryEndPos
        : anchorSpan.rawEndExclusive;

    if (
      insertionPoint > deletionSpan.rawStart &&
      insertionPoint < deletionSpan.rawEndExclusive
    ) {
      return {
        success: false,
        result: {
          message:
            "Invalid operation: textToBeMoved overlaps with the anchorText insertion point.",
        },
      };
    }

    const textToMoveSpan = {
      rawStart: deletionSpan.rawStart,
      rawEndExclusive: isLineBoundaryMove
        ? moveSpanLineBoundaryEndPos
        : moveSpan.rawEndExclusive,
    };
    let textToMove = sliceBySpan(rawTextChars, textToMoveSpan);
    if (isLineBoundaryMove) {
      if (p.positionRelativeToAnchorText === "before") textToMove += lineEnding;
      else textToMove = lineEnding + textToMove;
    }

    const newRawTextChars = [...rawTextChars];
    newRawTextChars.splice(
      deletionSpan.rawStart,
      deletionSpan.rawEndExclusive - deletionSpan.rawStart
    );

    const adjustedInsertPoint =
      insertionPoint <= deletionSpan.rawStart
        ? insertionPoint
        : insertionPoint -
          (deletionSpan.rawEndExclusive - deletionSpan.rawStart);

    newRawTextChars.splice(adjustedInsertPoint, 0, ...Array.from(textToMove));

    await fs.promises.writeFile(p.filePath, newRawTextChars.join(""), "utf-8");

    return {
      success: true,
      result: {
        message: `Successfully moved the text block ${p.positionRelativeToAnchorText} the matched anchorText in ${p.filePath}.`,
      },
    };
  } catch (err) {
    return {
      success: false,
      result: { message: messages.unexpectedError((err as Error).message) },
    };
  }
}

function expandEndLineBoundaryToIncludeTrailingNewLine(rawTextChars: string[], pos: number) {
  while(pos < rawTextChars.length && (rawTextChars[pos] === "\r" || rawTextChars[pos] === "\n"))
  {
    pos++;
  }

  return pos;
}

function isPosLineBoundary(rawTextChars: string[], pos: number) {
  return rawTextChars[pos] === "\n" || rawTextChars[pos] === "\r";
}

function findLineBoundaryToLeft(
  rawTextChars: string[],
  span: { rawStart: number }
): number {
  let start = span.rawStart;
  const hasStartReachedLineBoundary = () =>
    start === 0 || isPosLineBoundary(rawTextChars, start - 1);
  while (
    !hasStartReachedLineBoundary() &&
    WHITE_SPACE.test(rawTextChars[start - 1])
  ) {
    start--;
  }
  return hasStartReachedLineBoundary() ? start : -1;
}

function findLineBoundaryToRight(
  rawTextChars: string[],
  span: { rawEndExclusive: number }
): number {
  let end = span.rawEndExclusive;
  const hasEndReachedLineBoundary = () =>
    end === rawTextChars.length || isPosLineBoundary(rawTextChars, end);
  while (!hasEndReachedLineBoundary() && WHITE_SPACE.test(rawTextChars[end])) {
    end++;
  }
  return hasEndReachedLineBoundary() ? end : -1;
}

const MoveOrRenameFileParams = {
  sourceFilePath: z.string().describe("Current path of the file to rename."),
  targetFilePath: z.string().describe("New path/name for the file."),
  createMissingDirectories: z
    .boolean()
    .optional()
    .describe("If true, creates missing directories in the target file path."),
};

const MoveOrRenameFileParamsParser = z.object(MoveOrRenameFileParams);
type MoveOrRenameFileParamsType = z.infer<typeof MoveOrRenameFileParamsParser>;

async function moveOrRenameFileImpl(params: MoveOrRenameFileParamsType) {
  try {
    const p = MoveOrRenameFileParamsParser.parse(params);

    if (!fs.existsSync(p.sourceFilePath)) {
      return {
        success: false,
        result: { message: messages.fileNotExist(p.sourceFilePath) },
      };
    }

    if (fs.existsSync(p.targetFilePath)) {
      return {
        success: false,
        result: { message: messages.targetPathExists(p.targetFilePath) },
      };
    }

    const targetDir = path.dirname(p.targetFilePath);
    if (!fs.existsSync(targetDir)) {
      if (p.createMissingDirectories) {
        fs.mkdirSync(targetDir, { recursive: true });
      } else {
        return {
          success: false,
          result: {
            message: messages.directoryMissing(targetDir, p.targetFilePath),
          },
        };
      }
    }

    await fs.promises.rename(p.sourceFilePath, p.targetFilePath);
    return {
      success: true,
      result: {
        message: messages.success.renamed(p.sourceFilePath, p.targetFilePath),
      },
    };
  } catch (err) {
    return {
      success: false,
      result: { message: messages.unexpectedError((err as Error).message) },
    };
  }
}

const DeleteFileParams = {
  filePath: z
    .string()
    .describe(messages.descriptions.fileToBeOperatedOn("deleted", true)),
};

const DeleteFileParamsParser = z.object(DeleteFileParams);
type DeleteFileParamsType = z.infer<typeof DeleteFileParamsParser>;

async function deleteFileImpl(params: DeleteFileParamsType) {
  try {
    const p = DeleteFileParamsParser.parse(params);

    const fileValidation = await validateTextFileToEdit(p.filePath, false);
    if (!fileValidation.success) {
      return { success: false, result: { message: fileValidation.message! } };
    }
    await fs.promises.unlink(p.filePath);
    return {
      success: true,
      result: { message: messages.success.fileDeleted(p.filePath) },
    };
  } catch (err) {
    return {
      success: false,
      result: { message: messages.unexpectedError((err as Error).message) },
    };
  }
}

// ======================
// SERVER REGISTRATION
// ======================

const server = new McpServer(
  { name: "file_tools_server", version: "1.0.0", title: "File editing tools" },
  { capabilities: { tools: { listChanged: true } } }
);

server.registerTool(
  "replace_matching_text",
  {
    title: "Replace Matching Text",
    description: messages.descriptions.searchAndActionTool(
      "searchText",
      "replace"
    ),
    inputSchema: ReplaceMatchingTextParams,
    outputSchema: {
      message: z.string(),
      SuggestedParameterValues: z
        .array(z.object({ searchText: z.string() }))
        .optional()
        .describe(messages.descriptions.suggestedParamArray),
    },
  },
  async (params) => {
    const result = await replaceMatchingTextImpl(params);
    return {
      isError: !result.success,
      content: [{ type: "text", text: JSON.stringify(result.result) }],
      structuredContent: result.result,
    };
  }
);

server.registerTool(
  "delete_matching_text",
  {
    title: "Delete Matching Text",
    description: messages.descriptions.searchAndActionTool(
      "searchText",
      "delete"
    ),
    inputSchema: DeleteMatchingTextParams,
    outputSchema: {
      message: z.string(),
      SuggestedParameterValues: z
        .array(z.object({ searchText: z.string() }))
        .optional()
        .describe(messages.descriptions.suggestedParamArray),
    },
  },
  async (params) => {
    const result = await deleteMatchingTextImpl(
      params as DeleteMatchingTextParamsType
    );
    return {
      isError: !result.success,
      content: [{ type: "text", text: JSON.stringify(result.result) }],
      structuredContent: result.result,
    };
  }
);

server.registerTool(
  "create_file",
  {
    title: "Create File",
    description:
      "Create a new file with optional initial content. Fails if file already exists.",
    inputSchema: CreateFileParams,
    outputSchema: { message: z.string() },
  },
  async (params) => {
    const result = await createFileImpl(params as CreateFileParamsType);
    return {
      isError: !result.success,
      content: [{ type: "text", text: JSON.stringify(result.result) }],
      structuredContent: result.result,
    };
  }
);

server.registerTool(
  "overwrite_file_content",
  {
    title: "Overwrite File Content",
    description: "Completely overwrites an existing file with new content.",
    inputSchema: OverwriteFileContentParams,
    outputSchema: { message: z.string() },
  },
  async (params) => {
    const result = await overwriteFileContentImpl(
      params as OverwriteFileContentParamsType
    );
    return {
      isError: !result.success,
      content: [{ type: "text", text: JSON.stringify(result.result) }],
      structuredContent: result.result,
    };
  }
);

server.registerTool(
  "append_text_to_file",
  {
    title: "Append Text to File",
    description:
      "Append text to the end of an existing file, optionally ensuring a newline separator.",
    inputSchema: AppendTextToFileParams,
    outputSchema: { message: z.string() },
  },
  async (params) => {
    const result = await appendTextToFileImpl(
      params as AppendTextToFileParamsType
    );
    return {
      isError: !result.success,
      content: [{ type: "text", text: JSON.stringify(result.result) }],
      structuredContent: result.result,
    };
  }
);

server.registerTool(
  "insert_text",
  {
    title: "Insert Text",
    description: messages.descriptions.searchAndActionTool(
      "anchorText",
      "insert immediately after/before",
      false
    ),
    inputSchema: InsertTextParams,
    outputSchema: {
      message: z.string(),
      SuggestedParameterValues: z
        .array(
          z.object({
            searchText: z.string().optional(),
            anchorBlockStartMarker: z.string().optional(),
            anchorBlockEndMarker: z.string().optional(),
          })
        )
        .optional()
        .describe(messages.descriptions.suggestedParamArray),
    },
  },
  async (params) => {
    const result = await insertTextImpl(params as InsertTextParamsType);
    return {
      isError: !result.success,
      content: [{ type: "text", text: JSON.stringify(result.result) }],
      structuredContent: result.result,
    };
  }
);

server.registerTool(
  "move_text",
  {
    title: "Move Text",
    description: messages.descriptions.searchAndActionTool(
      "anchorText",
      "insert immediately after/before",
      false
    ),
    inputSchema: MoveTextParams,
    outputSchema: {
      message: z.string(),
      SuggestedParameterValues: z
        .array(
          z.object({
            textToBeMoved: z.string().optional(),
            searchText: z.string().optional(),
            anchorBlockStartMarker: z.string().optional(),
            anchorBlockEndMarker: z.string().optional(),
          })
        )
        .optional()
        .describe(messages.descriptions.suggestedParamArray),
    },
  },
  async (params) => {
    const result = await moveTextImpl(params as MoveTextParamsType);
    return {
      isError: !result.success,
      content: [{ type: "text", text: JSON.stringify(result.result) }],
      structuredContent: result.result,
    };
  }
);

server.registerTool(
  "move_or_rename_file",
  {
    title: "Move or Rename File",
    description:
      "Renames or moves a file to a new path. Fails if target already exists.",
    inputSchema: MoveOrRenameFileParams,
    outputSchema: { message: z.string() },
  },
  async (params) => {
    const result = await moveOrRenameFileImpl(
      params as MoveOrRenameFileParamsType
    );
    return {
      isError: !result.success,
      content: [{ type: "text", text: JSON.stringify(result.result) }],
      structuredContent: result.result,
    };
  }
);

server.registerTool(
  "delete_file",
  {
    title: "Delete File",
    description:
      "Deletes a file. Requires write permissions and file must exist.",
    inputSchema: DeleteFileParams,
    outputSchema: { message: z.string() },
  },
  async (params) => {
    const result = await deleteFileImpl(params as DeleteFileParamsType);
    return {
      isError: !result.success,
      content: [{ type: "text", text: JSON.stringify(result.result) }],
      structuredContent: result.result,
    };
  }
);

if (process.env.JEST_WORKER_ID === undefined) {
  const transport = new StdioServerTransport();
  server.connect(transport);
}

export {
  replaceMatchingTextImpl,
  deleteMatchingTextImpl,
  appendTextToFileImpl,
  insertTextImpl,
  moveTextImpl,
  createFileImpl,
  overwriteFileContentImpl,
  moveOrRenameFileImpl,
  deleteFileImpl,
};
