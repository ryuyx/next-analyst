import { Sandbox } from "@e2b/code-interpreter";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_SINGLE_FILE_SIZE = 5 * 1024 * 1024; // 5MB per file
const MAX_TOTAL_FILE_SIZE = 20 * 1024 * 1024; // 20MB total

export async function POST(req: Request) {
  const { tool, args, files } = await req.json();

  if (tool !== "execute_python") {
    return Response.json({ error: "Unsupported tool" }, { status: 400 });
  }

  const code = args?.code;
  if (!code) {
    return Response.json({ error: "No code provided" }, { status: 400 });
  }

  let sandbox: Sandbox | null = null;
  try {
    sandbox = await Sandbox.create({
      apiKey: process.env.E2B_API_KEY,
    });

    // Upload files to sandbox and track their names
    const uploadedFileNames = new Set<string>();
    if (files && Array.isArray(files)) {
      for (const file of files) {
        if (file.name && file.content) {
          const buffer = Buffer.from(file.content, "base64");
          await sandbox.files.write(`/home/user/${file.name}`, new Blob([buffer]));
          uploadedFileNames.add(file.name);
        }
      }
    }

    const execution = await sandbox.runCode(code);

    const stdout = execution.logs.stdout.join("\n");
    const stderr = execution.logs.stderr.join("\n");
    // Deduplicate results: if multiple results have png data, keep only unique ones
    // This prevents matplotlib auto-display + plt.show() + PIL.open from producing duplicates
    const rawResults = execution.results.map((r) => ({
      text: r.text,
      png: r.png,
      html: r.html,
    }));
    const seenPng = new Set<string>();
    const results = rawResults.filter((r) => {
      if (r.png) {
        // Use first 200 chars of base64 as fingerprint (same image = same prefix)
        const fingerprint = r.png.substring(0, 200);
        if (seenPng.has(fingerprint)) return false;
        seenPng.add(fingerprint);
      }
      return true;
    });

    // Detect newly generated files after code execution
    const generatedFiles: Array<{ name: string; content: string; size: number; richPreview?: Record<string, unknown> }> = [];
    if (!execution.error) {
      try {
        // List files in user directory via SDK
        const entries = await sandbox.files.list("/home/user");
        const newFileNames = entries
          .filter(
            (e) =>
              e.type === "file" &&
              !e.name.startsWith(".") &&
              !uploadedFileNames.has(e.name)
          )
          .map((e) => e.name);

        if (newFileNames.length > 0) {
          // Use Python to read and base64-encode new files (binary-safe)
          const namesJson = JSON.stringify(newFileNames);
          const readCode = `
import os, base64, json
_files = []
_total = 0
for _name in ${namesJson}:
    _fp = os.path.join('/home/user', _name)
    if os.path.isfile(_fp):
        _size = os.path.getsize(_fp)
        if _size <= ${MAX_SINGLE_FILE_SIZE} and _total + _size <= ${MAX_TOTAL_FILE_SIZE}:
            with open(_fp, 'rb') as _fh:
                _data = base64.b64encode(_fh.read()).decode()
            _files.append({'name': _name, 'size': _size, 'content': _data})
            _total += _size
print(json.dumps(_files))`;
          const fileReadExec = await sandbox.runCode(readCode);
          const fileOutput = fileReadExec.logs.stdout.join("").trim();
          if (fileOutput) {
            const parsedFiles = JSON.parse(fileOutput);
            generatedFiles.push(...parsedFiles);
          }
        }
      } catch {
        // Ignore file discovery errors - don't block the main result
      }

      // Generate rich previews for generated data files (reuse the still-running sandbox)
      const previewableExts = new Set(["csv", "tsv", "txt", "json", "xlsx", "xls", "parquet"]);
      for (const gf of generatedFiles) {
        const gfExt = gf.name.split(".").pop()?.toLowerCase() || "";
        if (!previewableExts.has(gfExt)) continue;
        try {
          const gfPath = `/home/user/${gf.name}`;
          const sep = gfExt === "tsv" ? "\\t" : ",";
          let readExpr: string;
          if (["csv", "tsv", "txt"].includes(gfExt)) {
            readExpr = `pd.read_csv("${gfPath}", sep="${sep}", nrows=100)`;
          } else if (["xlsx", "xls"].includes(gfExt)) {
            readExpr = `pd.read_excel("${gfPath}", nrows=100)`;
          } else if (gfExt === "json") {
            readExpr = `pd.read_json("${gfPath}")`;
          } else if (gfExt === "parquet") {
            readExpr = `pd.read_parquet("${gfPath}")`;
          } else {
            continue;
          }
          const previewPyCode = `
import pandas as pd, json
try:
    df = ${readExpr}
    _r = {"fileName":"${gf.name}","shape":list(df.shape),"columns":list(df.columns),"dtypes":{c:str(d) for c,d in df.dtypes.items()},"head":df.head(5).to_string(index=True),"describe":df.describe(include='all').to_string(),"null_counts":{k:int(v) for k,v in df.isnull().sum().to_dict().items()}}
    print(json.dumps(_r, ensure_ascii=False))
except Exception as _e:
    print(json.dumps({"error":str(_e)}))
`;
          const previewExec = await sandbox!.runCode(previewPyCode);
          const previewOut = previewExec.logs.stdout.join("").trim();
          if (previewOut) {
            const parsed = JSON.parse(previewOut);
            if (!parsed.error) {
              gf.richPreview = parsed;
            }
          }
        } catch {
          // Ignore preview errors
        }
      }
    }

    return Response.json({
      type: "code_execution",
      code,
      stdout,
      stderr,
      results,
      generatedFiles,
      error: execution.error
        ? execution.error.name + ": " + execution.error.value
        : null,
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "Unknown error";
    return Response.json({
      type: "code_execution_error",
      code,
      error: errMsg,
    });
  } finally {
    if (sandbox) {
      await sandbox.kill().catch(() => {});
    }
  }
}
