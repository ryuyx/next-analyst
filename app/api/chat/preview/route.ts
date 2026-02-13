import { Sandbox } from "@e2b/code-interpreter";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const SUPPORTED_FORMATS = new Set(["csv", "tsv", "txt", "json", "xlsx", "xls", "parquet"]);
const PREVIEW_HEAD_ROWS = 5; // Rows to display in preview
const PREVIEW_SAMPLE_ROWS = 1000; // Rows to sample for statistics (balance between accuracy and performance)

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

# First, count total rows efficiently
try:
    # Get total row count by counting lines
    with open("${filePath}", 'r', encoding='utf-8') as f:
        total_rows = sum(1 for _ in f) - 1  # subtract header
        total_rows = max(0, total_rows)
except:
    try:
        with open("${filePath}", 'r', encoding='gbk') as f:
            total_rows = sum(1 for _ in f) - 1
            total_rows = max(0, total_rows)
    except:
        total_rows = None

# Now load sample for analysis
try:
    df = pd.read_csv("${filePath}", sep="${sep}", nrows=${PREVIEW_SAMPLE_ROWS})
except Exception:
    # fallback: try with different encoding
    try:
        df = pd.read_csv("${filePath}", sep="${sep}", nrows=${PREVIEW_SAMPLE_ROWS}, encoding="gbk")
    except Exception as e:
        raise ValueError(f"Failed to parse file: {str(e)}")

if df.empty:
    raise ValueError("File is empty or contains no data rows")

# Use actual total row count if available, otherwise use sample shape
actual_rows = total_rows if total_rows is not None else df.shape[0]
shape = [actual_rows, df.shape[1]]
columns = list(df.columns)
dtypes = {col: str(dtype) for col, dtype in df.dtypes.items()}
head = df.head(${PREVIEW_HEAD_ROWS}).to_string(index=True)
describe = df.describe(include='all').to_string()
null_counts = df.isnull().sum().to_dict()

result = {
    "shape": shape,
    "columns": columns,
    "dtypes": dtypes,
    "head": head,
    "describe": describe,
    "null_counts": {k: int(v) for k, v in null_counts.items()},
    "sampled": actual_rows > ${PREVIEW_SAMPLE_ROWS},
}
print(json.dumps(result, ensure_ascii=False))
`;
    } else if (["xlsx", "xls"].includes(ext)) {
      previewCode = `
import pandas as pd
import json
from openpyxl import load_workbook

# Get actual row count from Excel file
try:
    wb = load_workbook("${filePath}", read_only=True)
    ws = wb.active
    total_rows = ws.max_row - 1  # subtract header
    total_cols = ws.max_column
    wb.close()
except:
    total_rows = None
    total_cols = None

# Load sample for analysis
try:
    df = pd.read_excel("${filePath}", nrows=${PREVIEW_SAMPLE_ROWS})
except Exception as e:
    raise ValueError(f"Failed to parse Excel file: {str(e)}")

if df.empty:
    raise ValueError("File is empty or contains no data rows")

# Use actual dimensions if available
actual_rows = total_rows if total_rows is not None else df.shape[0]
actual_cols = total_cols if total_cols is not None else df.shape[1]
shape = [actual_rows, actual_cols]
columns = list(df.columns)
dtypes = {col: str(dtype) for col, dtype in df.dtypes.items()}
head = df.head(${PREVIEW_HEAD_ROWS}).to_string(index=True)
describe = df.describe(include='all').to_string()
null_counts = df.isnull().sum().to_dict()

result = {
    "shape": shape,
    "columns": columns,
    "dtypes": dtypes,
    "head": head,
    "describe": describe,
    "null_counts": {k: int(v) for k, v in null_counts.items()},
    "sampled": actual_rows > ${PREVIEW_SAMPLE_ROWS},
}
print(json.dumps(result, ensure_ascii=False))
`;
    } else if (ext === "json") {
      previewCode = `
import pandas as pd
import json

try:
    df_full = pd.read_json("${filePath}")
    total_rows = len(df_full)
    # Sample rows if file is too large
    if total_rows > ${PREVIEW_SAMPLE_ROWS}:
        df = df_full.head(${PREVIEW_SAMPLE_ROWS})
    else:
        df = df_full
except Exception as e:
    raise ValueError(f"Failed to parse JSON file: {str(e)}")

if df.empty:
    raise ValueError("File is empty or contains no data rows")

shape = [total_rows, df.shape[1]]
columns = list(df.columns)
dtypes = {col: str(dtype) for col, dtype in df.dtypes.items()}
head = df.head(${PREVIEW_HEAD_ROWS}).to_string(index=True)
describe = df.describe(include='all').to_string()
null_counts = df.isnull().sum().to_dict()

result = {
    "shape": shape,
    "columns": columns,
    "dtypes": dtypes,
    "head": head,
    "describe": describe,
    "null_counts": {k: int(v) for k, v in null_counts.items()},
    "sampled": total_rows > ${PREVIEW_SAMPLE_ROWS},
}
print(json.dumps(result, ensure_ascii=False))
`;
    } else if (ext === "parquet") {
      previewCode = `
import pandas as pd
import json
import pyarrow.parquet as pq

# Get metadata for actual row count without loading all data
try:
    parquet_file = pq.ParquetFile("${filePath}")
    total_rows = parquet_file.metadata.num_rows
    
    # Read only the sample we need
    df = pd.read_parquet("${filePath}", engine='pyarrow')
    if len(df) > ${PREVIEW_SAMPLE_ROWS}:
        df = df.head(${PREVIEW_SAMPLE_ROWS})
except Exception as e:
    raise ValueError(f"Failed to parse Parquet file: {str(e)}")

if df.empty:
    raise ValueError("File is empty or contains no data rows")

shape = [total_rows, df.shape[1]]
columns = list(df.columns)
dtypes = {col: str(dtype) for col, dtype in df.dtypes.items()}
head = df.head(${PREVIEW_HEAD_ROWS}).to_string(index=True)
describe = df.describe(include='all').to_string()
null_counts = df.isnull().sum().to_dict()

result = {
    "shape": shape,
    "columns": columns,
    "dtypes": dtypes,
    "head": head,
    "describe": describe,
    "null_counts": {k: int(v) for k, v in null_counts.items()},
    "sampled": total_rows > ${PREVIEW_SAMPLE_ROWS},
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
