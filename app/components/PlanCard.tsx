"use client";

export interface PlanStep {
  id: string;
  title: string;
  description?: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  result?: string;
}

export interface Plan {
  id: string;
  steps: PlanStep[];
  currentStepIndex: number;
  isComplete: boolean;
}

interface PlanCardProps {
  plan: Plan;
}

function StepIcon({ status, index }: { status: PlanStep["status"]; index: number }) {
  const baseClass = "flex h-5 w-5 items-center justify-center rounded-full text-xs font-medium";

  switch (status) {
    case "completed":
      return (
        <div className={`${baseClass} bg-emerald-500 text-white`}>
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
      );
    case "in_progress":
      return (
        <div className={`${baseClass} bg-blue-500 text-white`}>
          <svg className="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      );
    case "failed":
      return (
        <div className={`${baseClass} bg-red-500 text-white`}>
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
      );
    default:
      return (
        <div className={`${baseClass} bg-zinc-200 text-zinc-500`}>
          {index + 1}
        </div>
      );
  }
}

export function PlanCard({ plan }: PlanCardProps) {
  const completedCount = plan.steps.filter((s) => s.status === "completed").length;
  const progress = plan.steps.length > 0 ? (completedCount / plan.steps.length) * 100 : 0;

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-zinc-200 bg-white text-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-100 bg-zinc-50 px-3 py-1.5">
        <div className="flex items-center gap-1.5 text-xs text-zinc-600">
          <span>📋</span>
          <span className="font-medium">执行计划</span>
          <span className="text-zinc-400">·</span>
          <span className="text-zinc-500">{completedCount}/{plan.steps.length}</span>
        </div>
        {plan.isComplete && (
          <span className="text-xs text-emerald-600">✓ 完成</span>
        )}
      </div>

      {/* Progress bar */}
      <div className="h-0.5 bg-zinc-100">
        <div
          className="h-full bg-emerald-500 transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Steps */}
      <div className="px-3 py-2">
        <div className="space-y-1">
          {plan.steps.map((step, index) => (
            <div
              key={step.id}
              className="flex items-center gap-2 py-0.5"
            >
              <StepIcon status={step.status} index={index} />
              <span
                className={`text-xs ${
                  step.status === "completed"
                    ? "text-emerald-600"
                    : step.status === "in_progress"
                    ? "text-blue-600 font-medium"
                    : step.status === "failed"
                    ? "text-red-600"
                    : "text-zinc-500"
                }`}
              >
                {step.title}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
