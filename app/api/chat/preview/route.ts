import { Sandbox } from "@e2b/code-interpreter";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const SUPPORTED_FORMATS = new Set(["csv", "tsv", "txt", "json", "xlsx", "xls", "parquet"]);

/**
 * Preview endpoint: uploads a file to a sandbox and uses pandas
 * to extract the first 5 rows, column types, shape, and basic stats.
 * Returns structured preview data for the AI to plan analysis.
 */
export async function POST(req: Request) {
  const { file } = await req.json();

  if (!file || !file.name || !file.content) {
    return Response.json({ error: "No file provided" }, { status: 400 });
  }

  // Validate file name
  if (typeof file.name !== "string" || file.name.length > 255) {
    return Response.json({ error: "Invalid file name" }, { status: 400 });
  }

  // Validate file content (base64 encoded)
  if (typeof file.content !== "string") {
    return Response.json({ error: "Invalid file content" }, { status: 400 });
  }

  // Check file size
  const buffer = Buffer.from(file.content, "base64");
  if (buffer.length > MAX_FILE_SIZE) {
    return Response.json(
      { error: `File too large (max ${MAX_FILE_SIZE / 1024 / 1024}MB)` },
      { status: 400 }
    );
  }

  // Check if file format is supported
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  if (!SUPPORTED_FORMATS.has(ext)) {
    return Response.json(
      { error: `Unsupported file format: ${ext}. Supported: ${Array.from(SUPPORTED_FORMATS).join(", ")}` },
      { status: 400 }
    );
  }

  let sandbox: Sandbox | null = null;
  try {
    sandbox = await Sandbox.create({
      apiKey: process.env.E2B_API_KEY,
    });

    // Upload file to sandbox
    const filePath = `/home/user/${file.name}`;
    await sandbox.files.write(filePath, new Blob([buffer]));

    // Build the preview script based on file type
    let previewCode: string;

    if (["csv", "tsv", "txt"].includes(ext)) {
      const sep = ext === "tsv" ? "\\t" : ",";
      previewCode = `
import pandas as pd
import json

try:
    df = pd.read_csv("${filePath}", sep="${sep}", nrows=100)
except Exception:
    # fallback: try with different encoding
    try:
        df = pd.read_csv("${filePath}", sep="${sep}", nrows=100, encoding="gbk")
    except Exception as e:
        raise ValueError(f"Failed to parse file: {str(e)}")

if df.empty:
    raise ValueError("File is empty or contains no data rows")

shape = list(df.shape)
columns = list(df.columns)
dtypes = {col: str(dtype) for col, dtype in df.dtypes.items()}
head = df.head(5).to_string(index=True)
describe = df.describe(include='all').to_string()
null_counts = df.isnull().sum().to_dict()

result = {
    "shape": shape,
    "columns": columns,
    "dtypes": dtypes,
    "head": head,
    "describe": describe,
    "null_counts": {k: int(v) for k, v in null_counts.items()},
}
print(json.dumps(result, ensure_ascii=False))
`;
    } else if (["xlsx", "xls"].includes(ext)) {
      previewCode = `
import pandas as pd
import json

try:
    df = pd.read_excel("${filePath}", nrows=100)
except Exception as e:
    raise ValueError(f"Failed to parse Excel file: {str(e)}")

if df.empty:
    raise ValueError("File is empty or contains no data rows")

shape = list(df.shape)
columns = list(df.columns)
dtypes = {col: str(dtype) for col, dtype in df.dtypes.items()}
head = df.head(5).to_string(index=True)
describe = df.describe(include='all').to_string()
null_counts = df.isnull().sum().to_dict()

result = {
    "shape": shape,
    "columns": columns,
    "dtypes": dtypes,
    "head": head,
    "describe": describe,
    "null_counts": {k: int(v) for k, v in null_counts.items()},
}
print(json.dumps(result, ensure_ascii=False))
`;
    } else if (ext === "json") {
      previewCode = `
import pandas as pd
import json

try:
    df = pd.read_json("${filePath}")
except Exception as e:
    raise ValueError(f"Failed to parse JSON file: {str(e)}")

if df.empty:
    raise ValueError("File is empty or contains no data rows")

shape = list(df.shape)
columns = list(df.columns)
dtypes = {col: str(dtype) for col, dtype in df.dtypes.items()}
head = df.head(5).to_string(index=True)
describe = df.describe(include='all').to_string()
null_counts = df.isnull().sum().to_dict()

result = {
    "shape": shape,
    "columns": columns,
    "dtypes": dtypes,
    "head": head,
    "describe": describe,
    "null_counts": {k: int(v) for k, v in null_counts.items()},
}
print(json.dumps(result, ensure_ascii=False))
`;
    } else if (ext === "parquet") {
      previewCode = `
import pandas as pd
import json

try:
    df = pd.read_parquet("${filePath}")
except Exception as e:
    raise ValueError(f"Failed to parse Parquet file: {str(e)}")

if df.empty:
    raise ValueError("File is empty or contains no data rows")

shape = list(df.shape)
columns = list(df.columns)
dtypes = {col: str(dtype) for col, dtype in df.dtypes.items()}
head = df.head(5).to_string(index=True)
describe = df.describe(include='all').to_string()
null_counts = df.isnull().sum().to_dict()

result = {
    "shape": shape,
    "columns": columns,
    "dtypes": dtypes,
    "head": head,
    "describe": describe,
    "null_counts": {k: int(v) for k, v in null_counts.items()},
}
print(json.dumps(result, ensure_ascii=False))
`;
    } else {
      // Fallback: just read the first lines as text
      previewCode = `
import json

with open("${filePath}", "r", encoding="utf-8") as f:
    lines = [f.readline() for _ in range(10)]

result = {
    "shape": [len(lines), 0],
    "columns": [],
    "dtypes": {},
    "head": "".join(lines),
    "describe": "",
    "null_counts": {},
}
print(json.dumps(result, ensure_ascii=False))
`;
    }

    const execution = await sandbox.runCode(previewCode);

    const stdout = execution.logs.stdout.join("\n").trim();
    const stderr = execution.logs.stderr.join("\n").trim();

    if (execution.error) {
      return Response.json({
        success: false,
        error: execution.error.name + ": " + execution.error.value,
        stderr,
      });
    }

    // Parse the JSON output from the script
    try {
      const preview = JSON.parse(stdout);
      return Response.json({
        success: true,
        preview: {
          fileName: file.name,
          ...preview,
        },
      });
    } catch {
      // If JSON parsing fails, return raw output
      return Response.json({
        success: true,
        preview: {
          fileName: file.name,
          shape: [0, 0],
          columns: [],
          dtypes: {},
          head: stdout || stderr,
          describe: "",
          null_counts: {},
        },
      });
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ success: false, error: errMsg }, { status: 500 });
  } finally {
    if (sandbox) {
      await sandbox.kill().catch(() => {});
    }
  }
}
