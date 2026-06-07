export interface SkillDefinition {
  id: string;
  label: string;
  description: string;
  systemPrompt: (context: string, extra?: string) => string;
}

export const SKILLS: Record<string, SkillDefinition> = {
  summarize: {
    id: "summarize",
    label: "Summarize",
    description: "Summarize the PDF content concisely",
    systemPrompt: (context: string) =>
      `You are a helpful assistant analyzing a PDF document. Summarize the following content from the PDF concisely. Include the main points and key takeaways.\n\nPDF Content:\n${context}`,
  },
  explain: {
    id: "explain",
    label: "Explain",
    description: "Explain the content in simpler terms",
    systemPrompt: (context: string) =>
      `You are a helpful assistant analyzing a PDF document. Explain the following content in simple, easy-to-understand terms. Break down complex ideas and use analogies where helpful.\n\nPDF Content:\n${context}`,
  },
  find: {
    id: "find",
    label: "Find",
    description: "Find specific information in the PDF",
    systemPrompt: (context: string) =>
      `You are a helpful assistant analyzing a PDF document. Based on the PDF content provided below, find and extract information relevant to the user's query. Be precise and cite where in the document the information appears.\n\nPDF Content:\n${context}`,
  },
  keypoints: {
    id: "keypoints",
    label: "Key Points",
    description: "Extract main takeaways as bullet points",
    systemPrompt: (context: string) =>
      `You are a helpful assistant analyzing a PDF document. Extract the 5-10 most important key points and takeaways from the following content. Present them as clear bullet points.\n\nPDF Content:\n${context}`,
  },
  critique: {
    id: "critique",
    label: "Critique",
    description: "Analyze and critique the content",
    systemPrompt: (context: string) =>
      `You are a helpful assistant analyzing a PDF document. Analyze the following content critically. Identify strengths, weaknesses, gaps in reasoning, potential contradictions, and any assumptions that should be questioned.\n\nPDF Content:\n${context}`,
  },
  quiz: {
    id: "quiz",
    label: "Quiz Me",
    description: "Generate quiz questions to test understanding",
    systemPrompt: (context: string) =>
      `You are a helpful assistant analyzing a PDF document. Generate 5 thoughtful quiz questions based on the following content. The questions should test comprehension, not just recall.\n\nIMPORTANT: Do NOT include the answers. Only show the numbered questions. End with: "Type 'show answers' to reveal the answers."\n\nPDF Content:\n${context}`,
  },
  translate: {
    id: "translate",
    label: "Translate",
    description: "Translate content to another language",
    systemPrompt: (context: string, targetLanguage?: string) =>
      `You are a helpful assistant analyzing a PDF document. Translate the following content to ${targetLanguage || "the user's requested language"}. Preserve the original formatting and meaning as much as possible.\n\nPDF Content:\n${context}`,
  },
};

export function getSkill(id: string): SkillDefinition | undefined {
  return SKILLS[id];
}

export function getAllSkills(): SkillDefinition[] {
  return Object.values(SKILLS);
}
