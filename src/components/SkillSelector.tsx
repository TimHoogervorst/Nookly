"use client";

import { getAllSkills } from "@/lib/skills";

interface Props {
  selectedSkill: string | null;
  onSelect: (skillId: string | null) => void;
}

export default function SkillSelector({ selectedSkill, onSelect }: Props) {
  const skills = getAllSkills();

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <button
        onClick={() => onSelect(null)}
        className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
          selectedSkill === null
            ? "bg-blue-600 text-white"
            : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
        }`}
      >
        Chat
      </button>
      {skills.map((skill) => (
        <button
          key={skill.id}
          onClick={() => onSelect(skill.id)}
          title={skill.description}
          className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
            selectedSkill === skill.id
              ? "bg-blue-600 text-white"
              : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
          }`}
        >
          {skill.label}
        </button>
      ))}
    </div>
  );
}
