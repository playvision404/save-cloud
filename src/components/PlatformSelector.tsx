"use client";

type Props = {
  platforms: string[];
  selected: string;
  onSelect: (platform: string) => void;
};

export default function PlatformSelector({
  platforms,
  selected,
  onSelect,
}: Props) {
  return (
    <div className="mt-8">
      <h2 className="text-2xl font-bold mb-3">
        Plattform
      </h2>

      <div className="flex flex-wrap gap-2">
        {platforms.map((platform) => (
          <button
            key={platform}
            onClick={() => onSelect(platform)}
            className={`rounded border px-4 py-2 ${
              selected === platform
                ? "bg-blue-600 text-white"
                : "bg-white"
            }`}
          >
            {platform}
          </button>
        ))}
      </div>
    </div>
  );
}