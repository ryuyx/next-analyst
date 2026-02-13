"use client";

import { useState } from "react";
import sampleQuestions from "@/data/sample-questions.json";
import type { FileAttachment } from "../hooks/useChat";

interface SampleQuestion {
  id: string;
  category: string;
  dataset: string | null;
  question: string;
  icon: string;
  description: string;
}

interface SampleQuestionsProps {
  onQuestionSelect: (question: string, file?: FileAttachment) => void;
}

export function SampleQuestions({ onQuestionSelect }: SampleQuestionsProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  const categories = ["all", ...new Set(sampleQuestions.questions.map(q => q.category))];

  const filteredQuestions = selectedCategory === "all"
    ? sampleQuestions.questions
    : sampleQuestions.questions.filter(q => q.category === selectedCategory);

  const handleQuestionClick = async (q: SampleQuestion) => {
    if (q.dataset) {
      // Fetch the dataset file and create a FileAttachment
      try {
        const response = await fetch(q.dataset);
        const blob = await response.blob();
        const filename = q.dataset.split('/').pop() || 'dataset.csv';
        
        // Convert blob to File and then to base64
        const file = new File([blob], filename, { type: blob.type || 'text/csv' });
        const reader = new FileReader();
        
        reader.onload = async () => {
          const result = reader.result as string;
          const base64 = result.split(",")[1] || "";
          
          // Read preview (first few lines)
          const textReader = new FileReader();
          textReader.onload = () => {
            const text = textReader.result as string;
            const lines = text.split("\n").slice(0, 6);
            const preview = lines.join("\n");
            
            const attachment: FileAttachment = {
              id: crypto.randomUUID(),
              name: filename,
              type: file.type || "text/csv",
              size: file.size,
              content: base64,
              preview,
            };
            
            onQuestionSelect(q.question, attachment);
          };
          const previewBlob = blob.slice(0, 8192);
          textReader.readAsText(previewBlob);
        };
        
        reader.readAsDataURL(file);
      } catch (error) {
        // If file fetch fails, just set the question without file
        onQuestionSelect(q.question);
      }
    } else {
      onQuestionSelect(q.question);
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto p-6 space-y-8">
      <div className="text-center space-y-3">
        <h2 className="text-3xl font-bold text-zinc-800 dark:text-zinc-100">
          Welcome to Next Analyst 🚀
        </h2>
        <p className="text-zinc-600 dark:text-zinc-400 max-w-2xl mx-auto">
          AI-powered data analysis assistant. Try these sample questions to get started:
        </p>
      </div>

      {/* Category Filter */}
      <div className="flex flex-wrap gap-2 justify-center">
        {categories.map((category) => (
          <button
            key={category}
            onClick={() => setSelectedCategory(category)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-all border ${
              selectedCategory === category
                ? "bg-indigo-600 border-indigo-600 text-white shadow-sm"
                : "bg-white dark:bg-zinc-800/50 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-600"
            }`}
          >
            {category === "all" ? "All Examples" : category}
          </button>
        ))}
      </div>

      {/* Questions Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredQuestions.map((q) => (
          <button
            key={q.id}
            onClick={() => handleQuestionClick(q)}
            className="group p-5 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 hover:border-indigo-500 dark:hover:border-indigo-500 transition-all hover:shadow-md text-left relative overflow-hidden"
          >
            <div className="flex items-start gap-4">
              <span className="text-3xl p-2 bg-zinc-50 dark:bg-zinc-800 rounded-lg group-hover:bg-indigo-50 dark:group-hover:bg-zinc-800 transition-colors">
                {q.icon}
              </span>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-1 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                  {q.description}
                </h3>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 line-clamp-2 leading-relaxed">
                  {q.question}
                </p>
                {q.dataset && (
                  <div className="mt-3 flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 px-2.5 py-1 rounded-md border border-indigo-100 dark:border-indigo-800/50">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      {q.dataset.split('/').pop()}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>

      <div className="text-center text-sm text-zinc-400 dark:text-zinc-500 pt-8 mt-2 border-t border-zinc-100 dark:border-zinc-800/50">
        💡 <strong>Tip:</strong> You can also upload your own CSV/Excel files or ask any data analysis question!
      </div>
    </div>
  );
}
