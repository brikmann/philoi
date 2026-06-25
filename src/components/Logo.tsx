const sizes = {
  sm: { icon: "w-6 h-6", text: "text-xl" },
  md: { icon: "w-8 h-8", text: "text-2xl" },
  lg: { icon: "w-12 h-12", text: "text-4xl" },
};

export default function Logo({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const { icon, text } = sizes[size];
  return (
    <div className="flex items-center gap-2">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 140 140"
        className={icon}
        aria-hidden="true"
      >
        <rect x="6" y="6" width="128" height="128" rx="34" fill="#3A2E5C" />
        <path d="M70,28 C52,54 49,70 70,86 C91,70 88,54 70,28 Z" fill="#E0612C" />
        <path d="M70,46 C59,62 58,76 70,86 C82,76 81,62 70,46 Z" fill="#F2A33C" />
        <path d="M70,62 C64,72 64,80 70,86 C76,80 76,72 70,62 Z" fill="#FFD27A" />
        <line x1="48" y1="96" x2="78" y2="84" stroke="#9C6336" strokeWidth="6" strokeLinecap="round" />
        <line x1="62" y1="84" x2="92" y2="96" stroke="#7E4A2C" strokeWidth="6" strokeLinecap="round" />
        <circle cx="70" cy="92" r="2" fill="#FFD27A" />
      </svg>
      <span className={`font-display font-semibold leading-none ${text}`}>
        <span className="text-coral">Phil</span>
        <span className="text-plum">oi</span>
      </span>
    </div>
  );
}
