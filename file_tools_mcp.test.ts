import * as fs from "fs";
import * as fsPromises from "fs/promises";
import * as path from "path";
import {
  replaceMatchingTextImpl,
  deleteMatchingTextImpl,
  createFileImpl,
  overwriteFileContentImpl,
  appendTextToFileImpl,
  insertTextImpl,
  moveOrRenameFileImpl,
  deleteFileImpl,
  moveTextImpl,
} from "./file_tools_mcp";

const accessSpy = jest.spyOn(fsPromises, "access");
const statSpy = jest.spyOn(fsPromises, "stat");
const readFileSpy = jest.spyOn(fsPromises, "readFile");
const writeFileSpy = jest.spyOn(fsPromises, "writeFile");
const unlinkSpy = jest.spyOn(fsPromises, "unlink");
const renameSpy = jest.spyOn(fsPromises, "rename");
const openSpy = jest.spyOn(fsPromises, "open");
const existsSyncSpy = jest.spyOn(fs, "existsSync");
const mkdirSyncSpy = jest.spyOn(fs, "mkdirSync");

const mockFileHandle = {
  read: jest.fn().mockImplementation(async (buffer: Buffer) => {
    return { bytesRead: 0, buffer };
  }),
  close: jest.fn().mockResolvedValue(undefined),
};

const testFilePath = path.join(__dirname, "mock_test_file.txt");
const testFileContent = fs.readFileSync(testFilePath, "utf-8");

describe("File editing Tools Test Suite", () => {
  let testDir: string;
  let testFilePath: string;

  beforeEach(() => {
    testDir = path.join(__dirname, ".testsTemp");
    testFilePath = path.join(testDir, "test.txt");
    jest.clearAllMocks();

    existsSyncSpy.mockReturnValue(true);
    accessSpy.mockResolvedValue(undefined);
    statSpy.mockResolvedValue({ size: 100 } as any);
    readFileSpy.mockResolvedValue("dummy content");
    openSpy.mockResolvedValue(mockFileHandle as any);
    writeFileSpy.mockResolvedValue(undefined);
    unlinkSpy.mockResolvedValue(undefined);
    renameSpy.mockResolvedValue(undefined);
    mkdirSyncSpy.mockReturnValue(undefined);
  });

  beforeAll(() => {
    jest.useFakeTimers();
  });

  afterAll(() => {
    jest.useRealTimers();
    accessSpy.mockRestore();
    statSpy.mockRestore();
    readFileSpy.mockRestore();
    writeFileSpy.mockRestore();
    unlinkSpy.mockRestore();
    renameSpy.mockRestore();
    openSpy.mockRestore();
    existsSyncSpy.mockRestore();
    mkdirSyncSpy.mockRestore();
  });

  describe("replaceMatchingTextImpl", () => {
    describe("File existence and permissions", () => {
      it("should fail if file does not exist", async () => {
        accessSpy.mockRejectedValue(new Error("Not found"));
        existsSyncSpy.mockReturnValue(false);
        const result = await replaceMatchingTextImpl({
          filePath: "_does_not_exist",
          searchText: "old",
          replacementText: "new",
        });
        expect(result.success).toBe(false);
        expect(result.result.message).toContain(
          "File _does_not_exist does not exist"
        );
      });

      it("should fail if file is not writable", async () => {
        accessSpy.mockRejectedValue(new Error("Permission denied"));
        readFileSpy.mockResolvedValue("content");

        const result = await replaceMatchingTextImpl({
          filePath: testFilePath,
          searchText: "old",
          replacementText: "new",
        });

        expect(result.success).toBe(false);
        expect(result.result.message).toContain("not readable or writable");
      });

      it("should fail if file is binary (detected by magic bytes)", async () => {
        // Mock file handle for binary detection
        const mockFileHandle = {
          read: jest.fn().mockImplementation(async (buffer: Buffer) => {
            if (buffer.length >= 3) {
              buffer[0] = 0xff;
              buffer[1] = 0xd8;
              buffer[2] = 0xff;
            }
            return { bytesRead: 3, buffer };
          }),
          close: jest.fn().mockResolvedValue(undefined),
        };

        openSpy.mockResolvedValue(mockFileHandle as any);

        const result = await replaceMatchingTextImpl({
          filePath: testFilePath,
          searchText: "old",
          replacementText: "new",
        });

        expect(result.success).toBe(false);
        expect(result.result.message).toContain("appears to be binary");
        expect(mockFileHandle.close).toHaveBeenCalled();
      });

      it("should fail if file does not exist and not rewriting", async () => {
        existsSyncSpy.mockReturnValue(false);

        const result = await replaceMatchingTextImpl({
          filePath: testFilePath,
          searchText: "old",
          replacementText: "new",
        });

        expect(result.success).toBe(false);
        expect(result.result.message).toContain("does not exist");
      });
    });

    describe("Validation logic", () => {
      it("should fail if searchText is missing", async () => {
        const result = await replaceMatchingTextImpl({
          filePath: testFilePath,
          replacementText: "new",
        });
        expect(result.success).toBe(false);
        expect(result.result.message).toContain(`"path": [
      "searchText"
    ],
    "message": "Required"`);
      });

      it("should fail if replacementText is missing", async () => {
        const result = await replaceMatchingTextImpl({
          filePath: testFilePath,
          searchText: "old",
        });
        expect(result.success).toBe(false);
        expect(result.result.message).toContain(`"path": [
      "replacementText"
    ],
    "message": "Required"`);
      });

      it("should fail if searchText and replacementText are identical", async () => {
        const result = await replaceMatchingTextImpl({
          filePath: testFilePath,
          searchText: "same",
          replacementText: "same",
        });
        expect(result.success).toBe(false);
        expect(result.result.message).toContain(
          "searchText and replacementText are identical"
        );
      });
    });

    describe("Exact matching and replacement", () => {
      it("should replace exact match", async () => {
        readFileSpy.mockResolvedValue("hello world\nfoo bar\nhello world");

        const result = await replaceMatchingTextImpl({
          filePath: testFilePath,
          searchText: "foo bar",
          replacementText: "baz qux",
        });

        expect(result.success).toBe(true);
        expect(result.result.message).toContain(
          "Successfully replaced 1 occurrence"
        );
        expect(writeFileSpy).toHaveBeenCalledWith(
          testFilePath,
          "hello world\nbaz qux\nhello world",
          "utf-8"
        );
      });

      it("should handle multiple exact matches and suggest disambiguation", async () => {
        readFileSpy.mockResolvedValue(
          "Only bar\nbar and foo\nonly foo no bar but could have been only bar"
        );

        const result = await replaceMatchingTextImpl({
          filePath: testFilePath,
          searchText: "foo",
          replacementText: "bar",
        });

        expect(result.success).toBe(false);
        expect(result.result.message).toContain("Multiple matches");
        expect(result.result.SuggestedParameterValues).toBeDefined();
        expect(result.result.SuggestedParameterValues).toEqual([
          {
            searchText: `and foo\nonly`,
          },
          {
            searchText: "only foo no",
          },
        ]);
      });

      it("should handle multiple exact matches on boundary  and suggest disambiguation", async () => {
        readFileSpy.mockResolvedValue(
          "foo no Only bar\nonly foo no bar but could have been only bar no foo"
        );

        const result = await replaceMatchingTextImpl({
          filePath: testFilePath,
          searchText: "foo",
          replacementText: "bar",
        });

        expect(result.success).toBe(false);
        expect(result.result.message).toContain("Multiple matches");
        expect(result.result.SuggestedParameterValues).toBeDefined();
        expect(result.result.SuggestedParameterValues).toEqual([
          {
            searchText: `foo no`,
          },
          {
            searchText: "only foo no",
          },
          {
            searchText: `no foo`,
          },
        ]);
      });

      it("should handle whitespace normalization in matching", async () => {
        readFileSpy.mockResolvedValue("  const  x  =  1;  ");

        const result = await replaceMatchingTextImpl({
          filePath: testFilePath,
          searchText: "const x=1",
          replacementText: "let y = 2",
        });

        expect(result.success).toBe(true);
        expect(writeFileSpy).toHaveBeenCalled();
      });
    });

    describe("Fuzzy matching and suggestions", () => {
      it("should suggest corrected searchText when only prefix of searchText matches", async () => {
        readFileSpy.mockResolvedValue(
          "function helloWorld() {\n  console.log('hi');\n}"
        );

        const result = await replaceMatchingTextImpl({
          filePath: testFilePath,
          searchText: "console.log(hi)", // missing quotes → prefix match
          replacementText: "console.log('hello')",
        });

        expect(result.success).toBe(false);
        expect(result.result.message).toContain(
          "No match found for searchText"
        );
        expect(result.result.SuggestedParameterValues).toBeDefined();
        expect(result.result.SuggestedParameterValues).toHaveLength(1);
        expect(result.result.SuggestedParameterValues![0].searchText).toContain(
          "console.log('hi')"
        );
      });

      it("should suggest corrected searchText when only suffix of searchText matches", async () => {
        readFileSpy.mockResolvedValue(
          "if (user) {\n  console.log('logged in');\n}"
        );

        const result = await replaceMatchingTextImpl({
          filePath: testFilePath,
          searchText: "cupsole.log('logged in');",
          replacementText: "console.log('authenticated');",
        });

        expect(result.success).toBe(false);
        expect(result.result.message).toContain(
          "No match found for searchText"
        );
        expect(result.result.SuggestedParameterValues).toBeDefined();
        expect(result.result.SuggestedParameterValues).toHaveLength(1);
        expect(result.result.SuggestedParameterValues![0].searchText).toContain(
          "console.log('logged in');"
        );
      });

      it("should suggest corrected searchText when both prefix and suffix of searchText matches", async () => {
        readFileSpy.mockResolvedValue("const msg = 'Hello';\nalert(msg);\n");

        const result = await replaceMatchingTextImpl({
          filePath: testFilePath,
          searchText: "msg = 'Hello';notify(msg)",
          replacementText: "const message = 'Hello';\nalert(message);",
        });

        expect(result.success).toBe(false);
        expect(result.result.message).toContain(
          "No match found for searchText"
        );
        expect(result.result.SuggestedParameterValues).toBeDefined();
        expect(result.result.SuggestedParameterValues).toHaveLength(1);
        expect(result.result.SuggestedParameterValues![0].searchText).toContain(
          "msg = 'Hello';\nalert(msg)"
        );
      });

      it("should suggest corrected searchText when neither prefix nor suffix of searchText matches but something in the middle does", async () => {
        readFileSpy.mockResolvedValue(
          "function greet() {\n  console.log('hello world');\n}\n"
        );

        const result = await replaceMatchingTextImpl({
          filePath: testFilePath,
          searchText: "cupsole.log(hello);",
          replacementText: "console.log('hi there')",
        });

        expect(result.success).toBe(false);
        expect(result.result.message).toContain(
          "No match found for searchText"
        );
        expect(result.result.SuggestedParameterValues).toBeDefined();
        expect(result.result.SuggestedParameterValues).toHaveLength(1);
        expect(result.result.SuggestedParameterValues![0].searchText).toContain(
          "console.log('hello world'"
        );
      });

      it("should return at most 3 suggestions (deduplication and limit)", async () => {
        readFileSpy.mockResolvedValue(
          "console.log('one');\nconsole.log('two');\nconsole.log('three');\nconsole.log('four');\nconsole.log('five');"
        );

        const result = await replaceMatchingTextImpl({
          filePath: testFilePath,
          searchText: "console.log(n)",
          replacementText: "console.log('n')",
        });

        expect(result.success).toBe(false);
        expect(result.result.message).toContain(
          "No match found for searchText"
        );
        expect(result.result.SuggestedParameterValues).toBeDefined();
        expect(result.result.SuggestedParameterValues!).toHaveLength(3);
      });
    });

    describe("Fuzzy matching on a large file", () => {
      beforeEach(async () => {
        readFileSpy.mockResolvedValue(testFileContent);
      });

      it("should suggest corrected searchText for template string usage (prefix match)", async () => {
        const result = await replaceMatchingTextImpl({
          filePath: testFilePath,
          searchText: "console.log('Hello, ' + user0.name);",
          replacementText: "console.log(`Hello, ${user0.name}!`);",
        });

        expect(result.success).toBe(false);
        expect(result.result.message).toContain(
          "No match found for searchText"
        );
        expect(result.result.SuggestedParameterValues).toBeDefined();
        expect(result.result.SuggestedParameterValues.length).toBeGreaterThan(
          0
        );
        expect(result.result.SuggestedParameterValues[0].searchText).toEqual(
          "console.log('Hello, user0!');\r\n}\r\nconst"
        );
      });

      it("should suggest corrected searchText for array mapping logic (suffix match)", async () => {
        const result = await replaceMatchingTextImpl({
          filePath: testFilePath,
          searchText: "data0.map(item => item);",
          replacementText: "data0.map(item => item.toUpperCase());",
        });

        expect(result.success).toBe(false);
        expect(result.result.SuggestedParameterValues).toBeDefined();
        expect(result.result.SuggestedParameterValues.length).toBeGreaterThan(
          0
        );
        expect(result.result.SuggestedParameterValues[0].searchText).toContain(
          "data0.map(item => item.value.toUpperCase());"
        );
      });

      it("should suggest corrected searchText for error handling block (prefix and suffix match)", async () => {
        const result = await replaceMatchingTextImpl({
          filePath: testFilePath,
          searchText:
            "try {\r\nprocessData1();\r\n} catch (error5) {\r\ncupsole.error('Error in block 1:', error);\r\n}",
          replacementText:
            "catch (error) { console.error('Error in block 0:', error); }",
        });

        expect(result.success).toBe(false);
        expect(result.result.SuggestedParameterValues).toBeDefined();
        expect(result.result.SuggestedParameterValues.length).toBeGreaterThan(
          0
        );
        expect(result.result.SuggestedParameterValues[0].searchText).toEqual(
          "try {\r\n    processData1();\r\n} catch (error) {\r\n    console.error('Error in block 1:', error);\r\n}"
        );
      });

      it("should suggest corrected searchText for config object structure (middle match)", async () => {
        const result = await replaceMatchingTextImpl({
          filePath: testFilePath,
          searchText: "const config = { retry: 3 };",
          replacementText:
            "const config0 = { retries: 1, timeout: 1000, verbose: true };",
        });

        expect(result.success).toBe(false);
        expect(result.result.SuggestedParameterValues).toBeDefined();
        expect(result.result.SuggestedParameterValues.length).toBeGreaterThan(
          0
        );
        expect(result.result.SuggestedParameterValues[0].searchText).toContain(
          "const config0 = { retries:"
        );
      });

      it("should suggest corrected searchText for forEach logging", async () => {
        const result = await replaceMatchingTextImpl({
          filePath: testFilePath,
          searchText: "data.forEach(item => console.log(item));",
          replacementText:
            "data.forEach(item => console.log(`Processing ${item.value}`));",
        });

        expect(result.success).toBe(false);
        expect(result.result.message).toContain(
          "No match found for searchText"
        );
        expect(result.result.SuggestedParameterValues).toBeDefined();
        expect(result.result.SuggestedParameterValues).toHaveLength(3);
      });
    });

    describe("Edge cases", () => {
      beforeEach(() => {
        statSpy.mockResolvedValue({ size: 0 } as any);
        readFileSpy.mockResolvedValue("");
      });

      it("should handle empty file gracefully", async () => {
        const result = await replaceMatchingTextImpl({
          filePath: testFilePath,
          searchText: "anything",
          replacementText: "new",
        });

        expect(result.success).toBe(false);
        expect(result.result.message).toContain(
          "No match found for searchText"
        );
      });
    });
  });

  describe("deleteMatchingTextImpl", () => {
    it("should delete exact match", async () => {
      readFileSpy.mockResolvedValue("hello world\nfoo bar\nhello world");

      const result = await deleteMatchingTextImpl({
        filePath: testFilePath,
        searchText: "foo bar",
      });

      expect(result.success).toBe(true);
      expect(result.result.message).toContain(
        "Successfully deleted 1 occurrence"
      );
      expect(writeFileSpy).toHaveBeenCalledWith(
        testFilePath,
        "hello world\n\nhello world",
        "utf-8"
      );
    });

    it("should fail if file does not exist", async () => {
      existsSyncSpy.mockReturnValue(false);

      const result = await deleteMatchingTextImpl({
        filePath: "_does_not_exist",
        searchText: "old",
      });

      expect(result.success).toBe(false);
      expect(result.result.message).toContain("does not exist");
    });

    it("should delete all matches when deleteAllMatches is true", async () => {
      readFileSpy.mockResolvedValue("foo bar foo baz foo");

      const result = await deleteMatchingTextImpl({
        filePath: testFilePath,
        searchText: "foo",
        deleteAllOccurrencesOfSearchText: true,
      });

      expect(result.success).toBe(true);
      expect(result.result.message).toContain(
        "Successfully deleted 3 occurrences"
      );
      expect(writeFileSpy).toHaveBeenCalledWith(
        testFilePath,
        " bar  baz ",
        "utf-8"
      );
    });

    it("should fail with multiple matches when deleteAllMatches is false", async () => {
      readFileSpy.mockResolvedValue("foo bar foo baz foo");

      const result = await deleteMatchingTextImpl({
        filePath: testFilePath,
        searchText: "foo",
        deleteAllOccurrencesOfSearchText: false,
      });

      expect(result.success).toBe(false);
      expect(result.result.message).toContain("Multiple matches found");
      expect(result.result.SuggestedParameterValues).toBeDefined();
    });

    it("should provide suggestions when no exact match found", async () => {
      readFileSpy.mockResolvedValue("hello world");

      const result = await deleteMatchingTextImpl({
        filePath: testFilePath,
        searchText: "helo world",
      });

      expect(result.success).toBe(false);
      expect(result.result.message).toContain("No match found");
      expect(result.result.SuggestedParameterValues).toBeDefined();
    });

    it("should fail if file is binary", async () => {
      const mockFileHandle = {
        read: jest.fn().mockImplementation(async (buffer: Buffer) => {
          buffer[0] = 0x00; // null byte indicates binary
          return { bytesRead: 1, buffer };
        }),
        close: jest.fn().mockResolvedValue(undefined),
      };
      openSpy.mockResolvedValue(mockFileHandle as any);

      const result = await deleteMatchingTextImpl({
        filePath: testFilePath,
        searchText: "text",
      });

      expect(result.success).toBe(false);
      expect(result.result.message).toContain("appears to be binary");
    });
  });

  describe("createFileImpl", () => {
    beforeEach(() => {
      existsSyncSpy.mockReturnValue(false); // File doesn't exist initially
    });

    it("should create new file with content", async () => {
      const result = await createFileImpl({
        filePath: testFilePath,
        fileContent: "Hello World",
        createMissingDirectories: true,
      });

      expect(result.success).toBe(true);
      expect(result.result.message).toContain(
        "File " + testFilePath + " created successfully"
      );
      expect(writeFileSpy).toHaveBeenCalledWith(
        testFilePath,
        "Hello World",
        "utf-8"
      );
    });

    it("should create new file with empty content when fileContent not provided", async () => {
      const result = await createFileImpl({
        filePath: testFilePath,
        createMissingDirectories: true,
      });

      expect(result.success).toBe(true);
      expect(result.result.message).toContain("created successfully");
      expect(writeFileSpy).toHaveBeenCalledWith(testFilePath, "", "utf-8");
    });

    it("should fail if file already exists", async () => {
      existsSyncSpy.mockReturnValue(true);

      const result = await createFileImpl({
        filePath: testFilePath,
        fileContent: "content",
      });

      expect(result.success).toBe(false);
      expect(result.result.message).toContain("already exists");
    });

    it("should fail if parent directory doesn't exist and createMissingDirectories is false", async () => {
      const nonExistentPath = path.join(testDir, "nonexistent", "test.txt");
      existsSyncSpy.mockImplementation((filePath) => {
        if (filePath === nonExistentPath) return false;
        if (filePath === path.dirname(nonExistentPath)) return false;
        return false;
      });

      const result = await createFileImpl({
        filePath: nonExistentPath,
        fileContent: "content",
        createMissingDirectories: false,
      });

      expect(result.success).toBe(false);
      expect(result.result.message).toContain("Parent directory");
      expect(result.result.message).toContain("does not exist");
    });

    it("should create parent directories when createMissingDirectories is true", async () => {
      const nonExistentPath = path.join(testDir, "newdir", "test.txt");
      existsSyncSpy.mockImplementation((filePath) => {
        if (filePath === nonExistentPath) return false;
        if (filePath === path.dirname(nonExistentPath)) return false;
        return false;
      });

      const result = await createFileImpl({
        filePath: nonExistentPath,
        fileContent: "content",
        createMissingDirectories: true,
      });

      expect(result.success).toBe(true);
      expect(mkdirSyncSpy).toHaveBeenCalledWith(path.dirname(nonExistentPath), {
        recursive: true,
      });
      expect(writeFileSpy).toHaveBeenCalledWith(
        nonExistentPath,
        "content",
        "utf-8"
      );
    });

    it("should handle unexpected errors", async () => {
      writeFileSpy.mockRejectedValue(new Error("Disk full"));

      const result = await createFileImpl({
        filePath: testFilePath,
        fileContent: "content",
        createMissingDirectories: true,
      });

      expect(result.success).toBe(false);
      expect(result.result.message).toContain("Error: Disk full");
    });
  });

  describe("overwriteFileContentImpl", () => {
    it("should overwrite existing file", async () => {
      const result = await overwriteFileContentImpl({
        filePath: testFilePath,
        fileContent: "New content",
      });

      expect(result.success).toBe(true);
      expect(result.result.message).toContain(
        "Successfully replaced entire content"
      );
      expect(writeFileSpy).toHaveBeenCalledWith(
        testFilePath,
        "New content",
        "utf-8"
      );
    });

    it("should fail if file does not exist", async () => {
      existsSyncSpy.mockReturnValue(false);

      const result = await overwriteFileContentImpl({
        filePath: testFilePath,
        fileContent: "content",
      });

      expect(result.success).toBe(false);
      expect(result.result.message).toContain("does not exist");
    });

    it("should fail if file is not writable", async () => {
      accessSpy.mockRejectedValue(new Error("Permission denied"));

      const result = await overwriteFileContentImpl({
        filePath: testFilePath,
        fileContent: "content",
      });

      expect(result.success).toBe(false);
      expect(result.result.message).toContain("not readable or writable");
    });

    it("should fail if file is binary", async () => {
      const mockFileHandle = {
        read: jest.fn().mockImplementation(async (buffer: Buffer) => {
          buffer[0] = 0x00; // null byte indicates binary
          return { bytesRead: 1, buffer };
        }),
        close: jest.fn().mockResolvedValue(undefined),
      };
      openSpy.mockResolvedValue(mockFileHandle as any);

      const result = await overwriteFileContentImpl({
        filePath: testFilePath,
        fileContent: "content",
      });

      expect(result.success).toBe(false);
      expect(result.result.message).toContain("appears to be binary");
    });

    it("should handle unexpected errors", async () => {
      writeFileSpy.mockRejectedValue(new Error("Disk full"));

      const result = await overwriteFileContentImpl({
        filePath: testFilePath,
        fileContent: "content",
      });

      expect(result.success).toBe(false);
      expect(result.result.message).toContain("Error: Disk full");
    });
  });

  describe("appendTextToFileImpl", () => {
    it("should append text to file with newline", async () => {
      readFileSpy.mockResolvedValue("existing content");

      const result = await appendTextToFileImpl({
        filePath: testFilePath,
        appendText: "new line",
        addNewLineBeforeAppending: true,
      });

      expect(result.success).toBe(true);
      expect(result.result.message).toContain(
        "Successfully appended provided text"
      );
      expect(writeFileSpy).toHaveBeenCalledWith(
        testFilePath,
        "existing content\nnew line",
        "utf-8"
      );
    });

    it("should append text without extra newline if file already ends with newline", async () => {
      readFileSpy.mockResolvedValue("existing content\n");

      const result = await appendTextToFileImpl({
        filePath: testFilePath,
        appendText: "new line",
        addNewLineBeforeAppending: true,
      });

      expect(result.success).toBe(true);
      expect(writeFileSpy).toHaveBeenCalledWith(
        testFilePath,
        "existing content\nnew line",
        "utf-8"
      );
    });

    it("should append text without newline when addNewLineBeforeAppending is false", async () => {
      readFileSpy.mockResolvedValue("existing content");

      const result = await appendTextToFileImpl({
        filePath: testFilePath,
        appendText: "new text",
        addNewLineBeforeAppending: false,
      });

      expect(result.success).toBe(true);
      expect(writeFileSpy).toHaveBeenCalledWith(
        testFilePath,
        "existing contentnew text",
        "utf-8"
      );
    });

    it("should handle Windows line endings", async () => {
      readFileSpy.mockResolvedValue("line1\r\nline2\r\n");

      const result = await appendTextToFileImpl({
        filePath: testFilePath,
        appendText: "line3",
        addNewLineBeforeAppending: true,
      });

      expect(result.success).toBe(true);
      expect(writeFileSpy).toHaveBeenCalledWith(
        testFilePath,
        "line1\r\nline2\r\nline3",
        "utf-8"
      );
    });

    it("should fail if file does not exist", async () => {
      existsSyncSpy.mockReturnValue(false);

      const result = await appendTextToFileImpl({
        filePath: testFilePath,
        appendText: "text",
      });

      expect(result.success).toBe(false);
      expect(result.result.message).toContain("does not exist");
    });
  });

  describe("insertTextImpl", () => {
    it("should fail if anchorText not found", async () => {
      readFileSpy.mockResolvedValue("some content");

      const result = await insertTextImpl({
        filePath: testFilePath,
        anchorText: "missing text",
        textToBeInserted: "new text",
        positionRelativeToAnchorText: "after",
      });

      expect(result.success).toBe(false);
      expect(result.result.message).toContain("No match found for anchorText");
      expect(result.result.SuggestedParameterValues).toBeDefined();
    });

    it("should fail if multiple matches found for anchorText", async () => {
      readFileSpy.mockResolvedValue("test\ntest\ntest");

      const result = await insertTextImpl({
        filePath: testFilePath,
        anchorText: "test",
        textToBeInserted: "inserted",
        positionRelativeToAnchorText: "after",
      });

      expect(result.success).toBe(false);
      expect(result.result.message).toContain(
        "Multiple matches found for anchorText"
      );
      expect(result.result.SuggestedParameterValues).toBeDefined();
    });

    it("should handle Windows line endings when adding newline", async () => {
      readFileSpy.mockResolvedValue("line1\r\nline2\r\n");

      const result = await insertTextImpl({
        filePath: testFilePath,
        anchorText: "line1",
        textToBeInserted: "inserted",
        addNewLine: true,
        positionRelativeToAnchorText: "after",
      });

      expect(result.success).toBe(true);
      expect(writeFileSpy).toHaveBeenCalledWith(
        testFilePath,
        "line1\r\ninserted\r\nline2\r\n",
        "utf-8"
      );
    });

    it("should insert text after anchor match", async () => {
      readFileSpy.mockResolvedValue(
        "function test() {\n  console.log('hello');\n}"
      );

      const result = await insertTextImpl({
        filePath: testFilePath,
        anchorText: "console.log('hello');",
        textToBeInserted: "\n  console.log('world');",
        positionRelativeToAnchorText: "after",
      });

      expect(result.success).toBe(true);
      expect(result.result.message).toContain(
        "Successfully inserted provided text after the matched anchorText"
      );
      expect(writeFileSpy).toHaveBeenCalledWith(
        testFilePath,
        "function test() {\n  console.log('hello');\n  console.log('world');\n}",
        "utf-8"
      );
    });

    it("should insert text after match with newline when addNewLineBeforeInserting is true", async () => {
      readFileSpy.mockResolvedValue("line1\nline2");

      const result = await insertTextImpl({
        filePath: testFilePath,
        anchorText: "line1",
        textToBeInserted: "inserted line",
        addNewLine: true,
        positionRelativeToAnchorText: "after",
      });

      expect(result.success).toBe(true);
      expect(writeFileSpy).toHaveBeenCalledWith(
        testFilePath,
        "line1\ninserted line\nline2",
        "utf-8"
      );
    });

    it("should insert text before anchor match", async () => {
      readFileSpy.mockResolvedValue(
        "function test() {\n  console.log('hello');\n}"
      );

      const result = await insertTextImpl({
        filePath: testFilePath,
        anchorText: "console.log('hello');",
        textToBeInserted: "  console.log('world');",
        positionRelativeToAnchorText: "before",
      });

      expect(result.success).toBe(true);
      expect(result.result.message).toContain(
        "Successfully inserted provided text before the matched anchorText"
      );
      expect(writeFileSpy).toHaveBeenCalledWith(
        testFilePath,
        "function test() {\n    console.log('world');console.log('hello');\n}",
        "utf-8"
      );
    });

    it("should insert text before match with newline when addNewLine is true", async () => {
      readFileSpy.mockResolvedValue("line1\nline2");

      const result = await insertTextImpl({
        filePath: testFilePath,
        anchorText: "line2",
        textToBeInserted: "inserted line",
        addNewLine: true,
        positionRelativeToAnchorText: "before",
      });

      expect(result.success).toBe(true);
      expect(writeFileSpy).toHaveBeenCalledWith(
        testFilePath,
        "line1\ninserted line\nline2",
        "utf-8"
      );
    });

    it("should insert after searchText within specified block", async () => {
      readFileSpy.mockResolvedValue(
        "header\nBLOCK START\nline1\nline2\nBLOCK END\nfooter"
      );

      const result = await insertTextImpl({
        filePath: testFilePath,
        anchorText: "line1",
        textToBeInserted: "inserted line",
        positionRelativeToAnchorText: "after",
        anchorBlockStartMarker: "BLOCK START",
        anchorBlockEndMarker: "BLOCK END",
        addNewLine: true,
      });

      expect(result.success).toBe(true);
      expect(writeFileSpy).toHaveBeenCalledWith(
        testFilePath,
        "header\nBLOCK START\nline1\ninserted line\nline2\nBLOCK END\nfooter",
        "utf-8"
      );
    });

    it("should insert before searchText within specified block", async () => {
      readFileSpy.mockResolvedValue(
        "header\nBLOCK START\nline1\nline2\nBLOCK END\nfooter"
      );

      const result = await insertTextImpl({
        filePath: testFilePath,
        anchorText: "line2",
        textToBeInserted: "inserted line",
        positionRelativeToAnchorText: "before",
        anchorBlockStartMarker: "BLOCK START",
        anchorBlockEndMarker: "BLOCK END",
        addNewLine: true,
      });

      expect(result.success).toBe(true);
      expect(writeFileSpy).toHaveBeenCalledWith(
        testFilePath,
        "header\nBLOCK START\nline1\ninserted line\nline2\nBLOCK END\nfooter",
        "utf-8"
      );
    });

    it("should use first anchorBlockStartMarker and last anchorBlockEndMarker if multiple exist", async () => {
      readFileSpy.mockResolvedValue(
        "BLOCK START\nlineA\nBLOCK END\nBLOCK START\nlineB\nBLOCK END"
      );

      const result = await insertTextImpl({
        filePath: testFilePath,
        anchorText: "lineB",
        textToBeInserted: "inserted line",
        positionRelativeToAnchorText: "after",
        anchorBlockStartMarker: "BLOCK START",
        anchorBlockEndMarker: "BLOCK END",
        addNewLine: true,
      });

      expect(result.success).toBe(true);
      expect(writeFileSpy).toHaveBeenCalledWith(
        testFilePath,
        "BLOCK START\nlineA\nBLOCK END\nBLOCK START\nlineB\ninserted line\nBLOCK END",
        "utf-8"
      );
    });

    it("should fail and provide suggestions if anchorText not found inside block", async () => {
      readFileSpy.mockResolvedValue("BLOCK START\nline1\nBLOCK END");

      const result = await insertTextImpl({
        filePath: testFilePath,
        anchorText: "missing",
        textToBeInserted: "inserted line",
        positionRelativeToAnchorText: "after",
        anchorBlockStartMarker: "BLOCK START",
        anchorBlockEndMarker: "BLOCK END",
      });

      expect(result.success).toBe(false);
      expect(result.result.message).toContain("No match found for anchorText");
      expect(result.result.SuggestedParameterValues).toBeDefined();
    });

    it("should fail if multiple matches for anchorText exist inside block", async () => {
      readFileSpy.mockResolvedValue("BLOCK START\nline1\nline1\nBLOCK END");

      const result = await insertTextImpl({
        filePath: testFilePath,
        anchorText: "line1",
        textToBeInserted: "inserted line",
        positionRelativeToAnchorText: "after",
        anchorBlockStartMarker: "BLOCK START",
        anchorBlockEndMarker: "BLOCK END",
      });

      expect(result.success).toBe(false);
      expect(result.result.message).toContain(
        "Multiple matches found for anchorText"
      );
      expect(result.result.SuggestedParameterValues).toBeDefined();
    });

    it("should not insert if anchorText exists outside block", async () => {
      readFileSpy.mockResolvedValue(
        "line1\nBLOCK START\nline2\nBLOCK END\nline1"
      );

      const result = await insertTextImpl({
        filePath: testFilePath,
        anchorText: "line1",
        textToBeInserted: "inserted line",
        positionRelativeToAnchorText: "after",
        anchorBlockStartMarker: "BLOCK START",
        anchorBlockEndMarker: "BLOCK END",
      });

      // should fail because "line1" inside block does not exist
      expect(result.success).toBe(false);
      expect(result.result.SuggestedParameterValues).toBeDefined();
    });

    it("should handle only anchorBlockStartMarker without anchorBlockEndMarker", async () => {
      readFileSpy.mockResolvedValue("line1\nBLOCK START\nline1\nfooter");

      const result = await insertTextImpl({
        filePath: testFilePath,
        anchorText: "line1",
        textToBeInserted: "inserted",
        positionRelativeToAnchorText: "after",
        anchorBlockStartMarker: "BLOCK START",
        addNewLine: true,
      });

      expect(result.success).toBe(true);
      expect(writeFileSpy).toHaveBeenCalledWith(
        testFilePath,
        "line1\nBLOCK START\nline1\ninserted\nfooter",
        "utf-8"
      );
    });

    it("should insert after searchText that overlaps anchorBlockStartMarker", async () => {
      readFileSpy.mockResolvedValue(
        "header\nBLOCK STARTline1\nline2\nBLOCK END\nfooter"
      );

      const result = await insertTextImpl({
        filePath: testFilePath,
        anchorText: "START line1",
        textToBeInserted: "inserted",
        positionRelativeToAnchorText: "after",
        anchorBlockStartMarker: "BLOCK START",
        anchorBlockEndMarker: "BLOCK END",
        addNewLine: true,
      });

      expect(result.success).toBe(true);
      expect(writeFileSpy).toHaveBeenCalledWith(
        testFilePath,
        "header\nBLOCK STARTline1\ninserted\nline2\nBLOCK END\nfooter",
        "utf-8"
      );
    });

    it("should insert before searchText that overlaps anchorBlockEndMarker", async () => {
      readFileSpy.mockResolvedValue(
        "header\nBLOCK START\nline1\nline2BLOCK END\nfooter"
      );

      const result = await insertTextImpl({
        filePath: testFilePath,
        anchorText: "line2BLOCK",
        textToBeInserted: "inserted",
        positionRelativeToAnchorText: "before",
        anchorBlockStartMarker: "BLOCK START",
        anchorBlockEndMarker: "BLOCK END",
      });

      expect(result.success).toBe(true);
      expect(writeFileSpy).toHaveBeenCalledWith(
        testFilePath,
        "header\nBLOCK START\nline1\ninsertedline2BLOCK END\nfooter",
        "utf-8"
      );
    });
  });

  describe("moveTextImpl", () => {
    it("should fail if textToBeMoved not found", async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue("some content");

      const result = await moveTextImpl({
        filePath: testFilePath,
        textToBeMoved: "missing text",
        anchorText: "anchor",
        positionRelativeToAnchorText: "after",
      });

      expect(result.success).toBe(false);
      expect(result.result.message).toContain(
        "No match found for textToBeMoved"
      );
      expect(result.result.SuggestedParameterValues).toBeDefined();
    });

    it("should fail if multiple matches found for textToBeMoved", async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue("test\ntest\ntest");

      const result = await moveTextImpl({
        filePath: testFilePath,
        textToBeMoved: "test",
        anchorText: "anchor",
        positionRelativeToAnchorText: "after",
      });

      expect(result.success).toBe(false);
      expect(result.result.message).toContain(
        "Multiple matches found for textToBeMoved"
      );
      expect(result.result.SuggestedParameterValues).toBeDefined();
    });

    it("should move single-line block before anchor at line boundary", async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue(
        "function alpha() {\n  const a = 1;\n  const b = 2;\n  const c = 3;\n}"
      );
      const result = await moveTextImpl({
        filePath: testFilePath,
        textToBeMoved: "const b = 2;",
        anchorText: "const a = 1;",
        positionRelativeToAnchorText: "before",
      });
      expect(result.success).toBe(true);
      expect(result.result.message).toContain(
        "Successfully moved the text block before the matched anchorText"
      );
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        testFilePath,
        "function alpha() {\n  const b = 2;\n  const a = 1;\n  const c = 3;\n}",
        "utf-8"
      );
    });

    it("should move single-line block after anchor at line boundary", async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue(
        "function alpha() {\n  const a = 1;\n  const b = 2;\n  const c = 3;\n}"
      );
      const result = await moveTextImpl({
        filePath: testFilePath,
        textToBeMoved: "const b = 2;",
        anchorText: "const c = 3;",
        positionRelativeToAnchorText: "after",
      });
      expect(result.success).toBe(true);
      expect(result.result.message).toContain(
        "Successfully moved the text block after the matched anchorText"
      );
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        testFilePath,
        "function alpha() {\n  const a = 1;\n  const c = 3;\n  const b = 2;\n}",
        "utf-8"
      );
    });

    it("should move single-line block before anchor not at line boundary", async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue(
        "function alpha() {\n  const a = 1;\n  const b = 2;\n  const c = 3; return c;\n}"
      );
      const result = await moveTextImpl({
        filePath: testFilePath,
        textToBeMoved: "const b = 2;",
        anchorText: "return c;",
        positionRelativeToAnchorText: "before",
      });
      expect(result.success).toBe(true);
      expect(result.result.message).toContain(
        "Successfully moved the text block before the matched anchorText"
      );
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        testFilePath,
        "function alpha() {\n  const a = 1;\n  \n  const c = 3; const b = 2;return c;\n}",
        "utf-8"
      );
    });

    it("should move single-line block after anchor not at line boundary", async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue(
        "function alpha() {\n  const a = 1;\n  const b = 2;\n  const c = 3; return c;\n}"
      );
      const result = await moveTextImpl({
        filePath: testFilePath,
        textToBeMoved: "const b = 2;",
        anchorText: "const c = 3;",
        positionRelativeToAnchorText: "after",
      });
      expect(result.success).toBe(true);
      expect(result.result.message).toContain(
        "Successfully moved the text block after the matched anchorText"
      );
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        testFilePath,
        "function alpha() {\n  const a = 1;\n  \n  const c = 3;const b = 2; return c;\n}",
        "utf-8"
      );
    });

    it("should move multi-line block before anchor at line boundary", async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue(
        "function alpha() {\n  const a = 1;\n  const b = 2;\n  const c = 3;\n  const d = 4;\n}"
      );
      const result = await moveTextImpl({
        filePath: testFilePath,
        textToBeMoved: "const b = 2;\nconst c = 3;",
        anchorText: "const a = 1;",
        positionRelativeToAnchorText: "before",
      });
      expect(result.success).toBe(true);
      expect(result.result.message).toContain(
        "Successfully moved the text block before the matched anchorText"
      );
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        testFilePath,
        "function alpha() {\n  const b = 2;\n  const c = 3;\n  const a = 1;\n  const d = 4;\n}",
        "utf-8"
      );
    });

    it("should move multi-line block after anchor at line boundary", async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue(
        "function alpha() {\n  const a = 1;\n  const b = 2;\n  const c = 3;\n  const d = 4;\n}"
      );
      const result = await moveTextImpl({
        filePath: testFilePath,
        textToBeMoved: "const b = 2;\nconst c = 3;",
        anchorText: "const d = 4;",
        positionRelativeToAnchorText: "after",
      });
      expect(result.success).toBe(true);
      expect(result.result.message).toContain(
        "Successfully moved the text block after the matched anchorText"
      );
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        testFilePath,
        "function alpha() {\n  const a = 1;\n  const d = 4;\n  const b = 2;\n  const c = 3;\n}",
        "utf-8"
      );
    });

    it("should move multi-line block before anchor not at line boundary", async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue(
        "function alpha() {\n  const a = 1; const b = 2;\n  const c = 3; const d = 4;\n  const e = 5;\n}"
      );
      const result = await moveTextImpl({
        filePath: testFilePath,
        textToBeMoved: "const b = 2;\nconst c = 3",
        anchorText: "const e = 5;",
        positionRelativeToAnchorText: "before",
      });
      expect(result.success).toBe(true);
      expect(result.result.message).toContain(
        "Successfully moved the text block before the matched anchorText"
      );
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        testFilePath,
        "function alpha() {\n  const a = 1; ; const d = 4;\n  const b = 2;\n  const c = 3const e = 5;\n}",
        "utf-8"
      );
    });

    it("should move multi-line block after anchor not at line boundary", async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue(
        "function alpha() {\n  const a = 1; const b = 2;\n  const c = 3; const d = 4;\n  const e = 5;\n}"
      );
      const result = await moveTextImpl({
        filePath: testFilePath,
        textToBeMoved: "const b = 2;\nconst c = 3",
        anchorText: "const d = 4;",
        positionRelativeToAnchorText: "after",
      });
      expect(result.success).toBe(true);
      expect(result.result.message).toContain(
        "Successfully moved the text block after the matched anchorText"
      );
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        testFilePath,
        "function alpha() {\n  const a = 1; ; const d = 4;const b = 2;\n  const c = 3\n  const e = 5;\n}",
        "utf-8"
      );
    });

    it("should move single-line partial before anchor at line boundary", async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue(
        "function alpha() {\n  const a = 1; const b = 2;\n  const c = 3;\n}"
      );
      const result = await moveTextImpl({
        filePath: testFilePath,
        textToBeMoved: "const b = 2",
        anchorText: "const a = 1;",
        positionRelativeToAnchorText: "before",
      });
      expect(result.success).toBe(true);
      expect(result.result.message).toContain(
        "Successfully moved the text block before the matched anchorText"
      );
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        testFilePath,
        "function alpha() {\n  const b = 2const a = 1; ;\n  const c = 3;\n}",
        "utf-8"
      );
    });

    it("should move single-line partial after anchor at line boundary", async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue(
        "function alpha() {\n  const a = 1; const b = 2;\n  const c = 3;\n}"
      );
      const result = await moveTextImpl({
        filePath: testFilePath,
        textToBeMoved: "const b = 2",
        anchorText: "const c = 3;",
        positionRelativeToAnchorText: "after",
      });
      expect(result.success).toBe(true);
      expect(result.result.message).toContain(
        "Successfully moved the text block after the matched anchorText"
      );
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        testFilePath,
        "function alpha() {\n  const a = 1; ;\n  const c = 3;const b = 2\n}",
        "utf-8"
      );
    });

    it("should move single-line partial before anchor not at line boundary", async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue(
        "function alpha() {\n  const a = 1;\n const b = 2;\n const c = 3; return a;\n}"
      );
      const result = await moveTextImpl({
        filePath: testFilePath,
        textToBeMoved: "const b = 2;",
        anchorText: "return a;",
        positionRelativeToAnchorText: "before",
      });
      expect(result.success).toBe(true);
      expect(result.result.message).toContain(
        "Successfully moved the text block before the matched anchorText"
      );
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        testFilePath,
        "function alpha() {\n  const a = 1;\n \n const c = 3; const b = 2;return a;\n}",
        "utf-8"
      );
    });

    it("should move single-line partial after anchor not at line boundary", async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue(
        "function alpha() {\n  const a = 1;\n const b = 2;\n const c = 3; return a;\n}"
      );
      const result = await moveTextImpl({
        filePath: testFilePath,
        textToBeMoved: "const b = 2;",
        anchorText: "const c = 3;",
        positionRelativeToAnchorText: "after",
      });
      expect(result.success).toBe(true);
      expect(result.result.message).toContain(
        "Successfully moved the text block after the matched anchorText"
      );
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        testFilePath,
        "function alpha() {\n  const a = 1;\n \n const c = 3;const b = 2; return a;\n}",
        "utf-8"
      );
    });

    it("should move multi-line partial before anchor at line boundary", async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue(
        "function alpha() {\n  const a = 1; const b = 2;\n  const c = 3; const d = 4;\n  const e = 5;\n}"
      );
      const result = await moveTextImpl({
        filePath: testFilePath,
        textToBeMoved: "const b = 2;const c = 3;",
        anchorText: "const e = 5;",
        positionRelativeToAnchorText: "before",
      });
      expect(result.success).toBe(true);
      expect(result.result.message).toContain(
        "Successfully moved the text block before the matched anchorText"
      );
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        testFilePath,
        "function alpha() {\n  const a = 1;  const d = 4;\n  const b = 2;\n  const c = 3;const e = 5;\n}",
        "utf-8"
      );
    });

    it("should move multi-line partial after anchor at line boundary", async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue(
        "function alpha() {\n  const a = 1; const b = 2;\n  const c = 3; const d = 4;\n  const e = 5;\n}"
      );
      const result = await moveTextImpl({
        filePath: testFilePath,
        textToBeMoved: "const b = 2;const c = 3;",
        anchorText: "const e = 5;",
        positionRelativeToAnchorText: "after",
      });
      expect(result.success).toBe(true);
      expect(result.result.message).toContain(
        "Successfully moved the text block after the matched anchorText"
      );
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        testFilePath,
        "function alpha() {\n  const a = 1;  const d = 4;\n  const e = 5;const b = 2;\n  const c = 3;\n}",
        "utf-8"
      );
    });

    it("should move multi-line partial before anchor not at line boundary", async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue(
        "function alpha() {\n  const a = 1; const b = 2;\n  const c = 3;\n  const d = 4; return sum;\n}"
      );
      const result = await moveTextImpl({
        filePath: testFilePath,
        textToBeMoved: "const b = 2;\nconst c = 3;",
        anchorText: "return sum;",
        positionRelativeToAnchorText: "before",
      });
      expect(result.success).toBe(true);
      expect(result.result.message).toContain(
        "Successfully moved the text block before the matched anchorText"
      );
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        testFilePath,
        "function alpha() {\n  const a = 1; \n  const d = 4; const b = 2;\n  const c = 3;return sum;\n}",
        "utf-8"
      );
    });

    it("should move multi-line partial after anchor not at line boundary", async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue(
        "function alpha() {\n  const a = 1; const b = 2;\n  const c = 3;\n  const d = 4; return sum;\n}"
      );
      const result = await moveTextImpl({
        filePath: testFilePath,
        textToBeMoved: "const b = 2;\n const c = 3;",
        anchorText: "const d = 4;",
        positionRelativeToAnchorText: "after",
      });
      expect(result.success).toBe(true);
      expect(result.result.message).toContain(
        "Successfully moved the text block after the matched anchorText"
      );
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        testFilePath,
        "function alpha() {\n  const a = 1; \n  const d = 4;const b = 2;\n  const c = 3; return sum;\n}",
        "utf-8"
      );
    });

    it("should handle moving text with complex indentation", async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue(
        "function nested() {\n  if (true) {\n    const x = 1;\n    const y = 2;\n  }\n  const z = 3;\n}"
      );
      const result = await moveTextImpl({
        filePath: testFilePath,
        textToBeMoved: "const x = 1;\n const y = 2;",
        anchorText: "const z = 3;",
        positionRelativeToAnchorText: "after",
      });
      expect(result.success).toBe(true);
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        testFilePath,
        "function nested() {\n  if (true) {\n  }\n  const z = 3;\n    const x = 1;\n    const y = 2;\n}",
        "utf-8"
      );
    });

    it("should handle moving text with mixed spaces and tabs", async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue(
        "function mix() {\nconst a = 1;\n  \tconst b = 2;\n    const c = 3;\n}"
      );
      const result = await moveTextImpl({
        filePath: testFilePath,
        textToBeMoved: "const b = 2;",
        anchorText: "const a = 1;",
        positionRelativeToAnchorText: "before",
      });
      expect(result.success).toBe(true);
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        testFilePath,
        "function mix() {\n  \tconst b = 2;\nconst a = 1;\n    const c = 3;\n}",
        "utf-8"
      );
    });

    it("should move text from beginning of file to middle - full line", async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue(
        "const first = 1;\nfunction test() {\n  const middle = 2;\n  const last = 3;\n}"
      );
      const result = await moveTextImpl({
        filePath: testFilePath,
        textToBeMoved: "const first = 1;",
        anchorText: "const middle = 2;",
        positionRelativeToAnchorText: "after",
      });
      expect(result.success).toBe(true);
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        testFilePath,
        "function test() {\n  const middle = 2;\nconst first = 1;\n  const last = 3;\n}",
        "utf-8"
      );
    });

    it("should move text from end of file to middle - full line", async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue(
        "function test() {\n  const first = 1;\n  const middle = 2;\n}\nconst last = 3;"
      );
      const result = await moveTextImpl({
        filePath: testFilePath,
        textToBeMoved: "const last = 3;",
        anchorText: "const middle = 2;",
        positionRelativeToAnchorText: "before",
      });
      expect(result.success).toBe(true);
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        testFilePath,
        "function test() {\n  const first = 1;\nconst last = 3;\n  const middle = 2;\n}\n",
        "utf-8"
      );
    });

    it("should move text to anchor at beginning of file - before", async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue(
        "const first = 1;\nfunction test() {\n  const middle = 2;\n  const move = 3;\n}"
      );
      const result = await moveTextImpl({
        filePath: testFilePath,
        textToBeMoved: "const move = 3;",
        anchorText: "const first = 1;",
        positionRelativeToAnchorText: "before",
      });
      expect(result.success).toBe(true);
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        testFilePath,
        "  const move = 3;\nconst first = 1;\nfunction test() {\n  const middle = 2;\n}",
        "utf-8"
      );
    });

    it("should move text to anchor at beginning of file - after", async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue(
        "const first = 1;\nfunction test() {\n  const middle = 2;\n  const move = 3;\n}"
      );
      const result = await moveTextImpl({
        filePath: testFilePath,
        textToBeMoved: "const move = 3;",
        anchorText: "const first = 1;",
        positionRelativeToAnchorText: "after",
      });
      expect(result.success).toBe(true);
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        testFilePath,
        "const first = 1;\n  const move = 3;\nfunction test() {\n  const middle = 2;\n}",
        "utf-8"
      );
    });

    it("should move text to anchor at end of file - before", async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue(
        "function test() {\n  const move = 1;\n  const middle = 2;\n}\nconst last = 3;"
      );
      const result = await moveTextImpl({
        filePath: testFilePath,
        textToBeMoved: "const move = 1;",
        anchorText: "const last = 3;",
        positionRelativeToAnchorText: "before",
      });
      expect(result.success).toBe(true);
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        testFilePath,
        "function test() {\n  const middle = 2;\n}\n  const move = 1;\nconst last = 3;",
        "utf-8"
      );
    });

    it("should move text to anchor at end of file - after", async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue(
        "function test() {\n  const move = 1;\n  const middle = 2;\n}\nconst last = 3;"
      );
      const result = await moveTextImpl({
        filePath: testFilePath,
        textToBeMoved: "const move = 1;",
        anchorText: "const last = 3;",
        positionRelativeToAnchorText: "after",
      });
      expect(result.success).toBe(true);
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        testFilePath,
        "function test() {\n  const middle = 2;\n}\nconst last = 3;\n  const move = 1;",
        "utf-8"
      );
    });

    it("should move multi-line block from beginning to end", async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue(
        "const a = 1;\nconst b = 2;\nfunction test() {\n  const middle = 3;\n}\nconst last = 4;"
      );
      const result = await moveTextImpl({
        filePath: testFilePath,
        textToBeMoved: "const a = 1;\nconst b = 2;",
        anchorText: "const last = 4;",
        positionRelativeToAnchorText: "before",
      });
      expect(result.success).toBe(true);
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        testFilePath,
        "function test() {\n  const middle = 3;\n}\nconst a = 1;\nconst b = 2;\nconst last = 4;",
        "utf-8"
      );
    });

    it("should move multi-line block from end to beginning", async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue(
        "const first = 1;\nfunction test() {\n  const middle = 2;\n}\nconst a = 3;\nconst b = 4;"
      );
      const result = await moveTextImpl({
        filePath: testFilePath,
        textToBeMoved: "const a = 3;\nconst b = 4;",
        anchorText: "const first = 1;",
        positionRelativeToAnchorText: "after",
      });
      expect(result.success).toBe(true);
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        testFilePath,
        "const first = 1;\nconst a = 3;\nconst b = 4;\nfunction test() {\n  const middle = 2;\n}\n",
        "utf-8"
      );
    });

    it("should handle partial text at beginning of file with anchor not at line boundary", async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue(
        "const first = 1; const second = 2;\nfunction test() {\n  return 'done';\n}"
      );
      const result = await moveTextImpl({
        filePath: testFilePath,
        textToBeMoved: "const first = 1;",
        anchorText: "return 'done';",
        positionRelativeToAnchorText: "before",
      });
      expect(result.success).toBe(true);
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        testFilePath,
        " const second = 2;\nfunction test() {\n  const first = 1;return 'done';\n}",
        "utf-8"
      );
    });

    it("should handle partial text at end of file with anchor not at line boundary", async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue(
        "function test() {\n  const start = 1; const end = 3;\n  return 'done'; const middle = 2;"
      );
      const result = await moveTextImpl({
        filePath: testFilePath,
        textToBeMoved: "const middle = 2;",
        anchorText: "const start = 1;",
        positionRelativeToAnchorText: "after",
      });
      expect(result.success).toBe(true);
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        testFilePath,
        "function test() {\n  const start = 1;const middle = 2; const end = 3;\n  return 'done'; ",
        "utf-8"
      );
    });

    it("should handle entire file content being moved", async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue(
        "const only = 1;\nconst content = 2;"
      );
      const result = await moveTextImpl({
        filePath: testFilePath,
        textToBeMoved: "const content = 2;",
        anchorText: "const only = 1;",
        positionRelativeToAnchorText: "before",
      });
      expect(result.success).toBe(true);
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        testFilePath,
        "const content = 2;\nconst only = 1;\n",
        "utf-8"
      );
    });

    it("should handle single line file with partial move", async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue(
        "const a = 1; const b = 2; const c = 3;"
      );
      const result = await moveTextImpl({
        filePath: testFilePath,
        textToBeMoved: "const b = 2;",
        anchorText: "const c = 3;",
        positionRelativeToAnchorText: "after",
      });
      expect(result.success).toBe(true);
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        testFilePath,
        "const a = 1;  const c = 3;const b = 2;",
        "utf-8"
      );
    });

    it("should move text after anchorText within specified block", async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue(
        "header\nBLOCK START\nline1\nfooter\nBLOCK END\nfooter"
      );

      const result = await moveTextImpl({
        filePath: testFilePath,
        textToBeMoved: "line1",
        anchorText: "footer",
        positionRelativeToAnchorText: "after",
        anchorBlockStartMarker: "BLOCK START",
        anchorBlockEndMarker: "BLOCK END",
      });

      expect(result.success).toBe(true);
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        testFilePath,
        "header\nBLOCK START\nfooter\nline1\nBLOCK END\nfooter",
        "utf-8"
      );
    });

    it("should move text before anchorText within specified block", async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue(
        "header\nBLOCK START\nheader\nline2\nBLOCK END\nfooter"
      );

      const result = await moveTextImpl({
        filePath: testFilePath,
        textToBeMoved: "line2",
        anchorText: "header",
        positionRelativeToAnchorText: "before",
        anchorBlockStartMarker: "BLOCK START",
        anchorBlockEndMarker: "BLOCK END",
      });

      expect(result.success).toBe(true);
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        testFilePath,
        "header\nBLOCK START\nline2\nheader\nBLOCK END\nfooter",
        "utf-8"
      );
    });

    it("should use first blockStartMarker and last blockEndMarker if multiple exist", async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue(
        "BLOCK START\nlineA\nBLOCK END\nmiddleLine\nBLOCK START\nlineB\nlineC\nBLOCK END\nmiddleLine"
      );

      const result = await moveTextImpl({
        filePath: testFilePath,
        textToBeMoved: "lineC",
        anchorText: "middleLine",
        positionRelativeToAnchorText: "before",
        anchorBlockStartMarker: "BLOCK START",
        anchorBlockEndMarker: "BLOCK END",
      });

      expect(result.success).toBe(true);
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        testFilePath,
        "BLOCK START\nlineA\nBLOCK END\nlineC\nmiddleLine\nBLOCK START\nlineB\nBLOCK END\nmiddleLine",
        "utf-8"
      );
    });

    it("should fail and provide suggestions if anchorText not found inside block", async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue(
        "missing\nBLOCK START\nline1\nBLOCK END\nmissing"
      );

      const result = await moveTextImpl({
        filePath: testFilePath,
        textToBeMoved: "line1",
        anchorText: "missing",
        positionRelativeToAnchorText: "after",
        anchorBlockStartMarker: "BLOCK START",
        anchorBlockEndMarker: "BLOCK END",
      });

      expect(result.success).toBe(false);
      expect(result.result.message).toContain("No match found for anchorText");
      expect(result.result.SuggestedParameterValues).toBeDefined();
    });

    it("should fail if multiple matches exist inside block for anchorText", async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue(
        "some text BLOCK START\nline1\nline1\nBLOCK END"
      );

      const result = await moveTextImpl({
        filePath: testFilePath,
        textToBeMoved: "some text",
        anchorText: "line1",
        positionRelativeToAnchorText: "after",
        anchorBlockStartMarker: "BLOCK START",
        anchorBlockEndMarker: "BLOCK END",
      });

      expect(result.success).toBe(false);
      expect(result.result.message).toContain(
        "Multiple matches found for anchorText"
      );
      expect(result.result.SuggestedParameterValues).toBeDefined();
    });

    it("should handle only blockStartMarker without blockEndMarker", async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue(
        "line1\nBLOCK START\nline1\nfooter"
      );

      const result = await moveTextImpl({
        filePath: testFilePath,
        textToBeMoved: "footer",
        anchorText: "line1",
        positionRelativeToAnchorText: "before",
        anchorBlockStartMarker: "BLOCK START",
      });

      expect(result.success).toBe(true);
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        testFilePath,
        "line1\nBLOCK START\nfooter\nline1\n",
        "utf-8"
      );
    });

    it("should move text after anchorText that overlaps blockStartMarker", async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue(
        "header\nBLOCK STARTline1\nline2\nBLOCK END\nfooter"
      );

      const result = await moveTextImpl({
        filePath: testFilePath,
        textToBeMoved: "footer",
        anchorText: "START line1",
        positionRelativeToAnchorText: "after",
        anchorBlockStartMarker: "BLOCK START",
        anchorBlockEndMarker: "BLOCK END",
      });

      expect(result.success).toBe(true);
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        testFilePath,
        "header\nBLOCK STARTline1\nfooter\nline2\nBLOCK END\n",
        "utf-8"
      );
    });

    it("should move text before anchorText that overlaps blockEndMarker", async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue(
        "header\nBLOCK START\nline1\nline2BLOCK END\nfooter"
      );

      const result = await moveTextImpl({
        filePath: testFilePath,
        textToBeMoved: "header",
        anchorText: "line2BLOCK",
        positionRelativeToAnchorText: "before",
        anchorBlockStartMarker: "BLOCK START",
        anchorBlockEndMarker: "BLOCK END",
      });

      expect(result.success).toBe(true);
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        testFilePath,
        "BLOCK START\nline1\nheader\nline2BLOCK END\nfooter",
        "utf-8"
      );
    });

    it("should handle Windows line endings when adding newline", async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue(
        "line1\r\nline2\r\nline3\r\n"
      );

      const result = await moveTextImpl({
        filePath: testFilePath,
        textToBeMoved: "line1",
        anchorText: "line2",
        positionRelativeToAnchorText: "after",
      });

      expect(result.success).toBe(true);
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        testFilePath,
        "line2\r\nline1\r\nline3\r\n",
        "utf-8"
      );
    });
  });

  describe("moveOrRenameFileImpl", () => {
    it("should rename file successfully", async () => {
      const newPath = path.join(testDir, "renamed.txt");
      existsSyncSpy.mockImplementation((filePath) => {
        if (filePath === testFilePath) return true;
        if (filePath === newPath) return false;
        if (filePath === path.dirname(newPath)) return true;
        return false;
      });

      const result = await moveOrRenameFileImpl({
        sourceFilePath: testFilePath,
        targetFilePath: newPath,
      });

      expect(result.success).toBe(true);
      expect(result.result.message).toContain("Successfully moved or renamed ");
      expect(renameSpy).toHaveBeenCalledWith(testFilePath, newPath);
    });

    it("should fail if source file does not exist", async () => {
      existsSyncSpy.mockReturnValue(false);

      const result = await moveOrRenameFileImpl({
        sourceFilePath: testFilePath,
        targetFilePath: path.join(testDir, "new.txt"),
      });

      expect(result.success).toBe(false);
      expect(result.result.message).toContain("does not exist");
    });

    it("should fail if target file already exists", async () => {
      const targetPath = path.join(testDir, "existing.txt");
      existsSyncSpy.mockImplementation((filePath) => {
        if (filePath === testFilePath) return true;
        if (filePath === targetPath) return true;
        return false;
      });

      const result = await moveOrRenameFileImpl({
        sourceFilePath: testFilePath,
        targetFilePath: targetPath,
      });

      expect(result.success).toBe(false);
      expect(result.result.message).toContain("already exists");
    });

    it("should create missing directories when createMissingDirectories is true", async () => {
      const targetPath = path.join(testDir, "newdir", "file.txt");
      existsSyncSpy.mockImplementation((filePath) => {
        if (filePath === testFilePath) return true;
        if (filePath === targetPath) return false;
        if (filePath === path.dirname(targetPath)) return false;
        return false;
      });

      const result = await moveOrRenameFileImpl({
        sourceFilePath: testFilePath,
        targetFilePath: targetPath,
        createMissingDirectories: true,
      });

      expect(result.success).toBe(true);
      expect(mkdirSyncSpy).toHaveBeenCalledWith(path.dirname(targetPath), {
        recursive: true,
      });
      expect(renameSpy).toHaveBeenCalledWith(testFilePath, targetPath);
    });

    it("should fail if target directory does not exist and createMissingDirectories is false", async () => {
      const targetPath = path.join(testDir, "nonexistent", "file.txt");
      existsSyncSpy.mockImplementation((filePath) => {
        if (filePath === testFilePath) return true;
        if (filePath === targetPath) return false;
        if (filePath === path.dirname(targetPath)) return false;
        return false;
      });

      const result = await moveOrRenameFileImpl({
        sourceFilePath: testFilePath,
        targetFilePath: targetPath,
        createMissingDirectories: false,
      });

      expect(result.success).toBe(false);
      expect(result.result.message).toContain("Parent directory");
      expect(result.result.message).toContain("does not exist");
    });

    it("should handle unexpected errors", async () => {
      const targetPath = path.join(testDir, "new.txt");
      existsSyncSpy.mockImplementation((filePath) => {
        if (filePath === testFilePath) return true;
        if (filePath === targetPath) return false;
        if (filePath === path.dirname(targetPath)) return true;
        return false;
      });
      renameSpy.mockRejectedValue(new Error("Permission denied"));

      const result = await moveOrRenameFileImpl({
        sourceFilePath: testFilePath,
        targetFilePath: targetPath,
      });

      expect(result.success).toBe(false);
      expect(result.result.message).toContain("Error: Permission denied");
    });
  });

  describe("deleteFileImpl", () => {
    it("should delete file successfully", async () => {
      const result = await deleteFileImpl({
        filePath: testFilePath,
      });

      expect(result.success).toBe(true);
      expect(result.result.message).toContain("Successfully deleted ");
      expect(unlinkSpy).toHaveBeenCalledWith(testFilePath);
    });

    it("should fail if file does not exist", async () => {
      existsSyncSpy.mockReturnValue(false);

      const result = await deleteFileImpl({
        filePath: testFilePath,
      });

      expect(result.success).toBe(false);
      expect(result.result.message).toContain("does not exist");
    });

    it("should fail if file is not writable", async () => {
      accessSpy.mockRejectedValue(new Error("Permission denied"));

      const result = await deleteFileImpl({
        filePath: testFilePath,
      });

      expect(result.success).toBe(false);
      expect(result.result.message).toContain("not readable or writable");
    });

    it("should handle unexpected errors", async () => {
      unlinkSpy.mockRejectedValue(new Error("File is locked"));

      const result = await deleteFileImpl({
        filePath: testFilePath,
      });

      expect(result.success).toBe(false);
      expect(result.result.message).toContain("Error: File is locked");
    });

    it("should not check for binary files (binary check disabled for delete)", async () => {
      const mockFileHandle = {
        read: jest.fn().mockImplementation(async (buffer: Buffer) => {
          buffer[0] = 0x00; // null byte indicates binary
          return { bytesRead: 1, buffer };
        }),
        close: jest.fn().mockResolvedValue(undefined),
      };
      openSpy.mockResolvedValue(mockFileHandle as any);

      const result = await deleteFileImpl({
        filePath: testFilePath,
      });

      expect(result.success).toBe(true);
      expect(result.result.message).toContain("Successfully deleted ");
      expect(unlinkSpy).toHaveBeenCalledWith(testFilePath);
      expect(mockFileHandle.read).not.toHaveBeenCalled();
    });
  });
});
