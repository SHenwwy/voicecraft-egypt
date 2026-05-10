// Egyptian Arabic prompt categories with realistic STT challenges baked in.
export type Category = {
  id: string;
  label: string;
  labelAr: string;
  description: string;
  langMixPctRange: [number, number]; // % English in code-switching
  emotions: string[];
  styles: string[];
};

export const CATEGORIES: Category[] = [
  {
    id: "food_ordering",
    label: "Food ordering",
    labelAr: "طلب أكل",
    description: "Calling restaurants, delivery apps, dictating addresses, modifying orders.",
    langMixPctRange: [0, 25],
    emotions: ["neutral", "rushed", "happy"],
    styles: ["conversational", "phone_call"],
  },
  {
    id: "transport",
    label: "Ride hailing & transport",
    labelAr: "مواصلات",
    description: "Uber/Careem driver chat, directions, microbus phrases, traffic.",
    langMixPctRange: [0, 30],
    emotions: ["neutral", "frustrated", "rushed"],
    styles: ["conversational", "phone_call"],
  },
  {
    id: "customer_support",
    label: "Customer support",
    labelAr: "خدمة عملاء",
    description: "Bank, telecom, ISP, complaints, account verification.",
    langMixPctRange: [10, 50],
    emotions: ["neutral", "frustrated", "polite"],
    styles: ["formal", "phone_call"],
  },
  {
    id: "fintech",
    label: "Fintech & banking",
    labelAr: "فلوس وبنوك",
    description: "Wallet transfers, IBAN, currency, salaries, instalments.",
    langMixPctRange: [10, 40],
    emotions: ["neutral", "concerned"],
    styles: ["formal"],
  },
  {
    id: "medical",
    label: "Medical & pharmacy",
    labelAr: "طب وصيدلية",
    description: "Booking appointments, symptoms, dosages, prescriptions.",
    langMixPctRange: [10, 40],
    emotions: ["neutral", "worried"],
    styles: ["formal", "conversational"],
  },
  {
    id: "marketplace",
    label: "Marketplace & shopping",
    labelAr: "تسوق",
    description: "OLX/Souq haggling, sizes, payment on delivery, returns.",
    langMixPctRange: [0, 25],
    emotions: ["neutral", "happy", "skeptical"],
    styles: ["conversational"],
  },
  {
    id: "social_media",
    label: "Social media voice notes",
    labelAr: "ڤويس نوت",
    description: "WhatsApp/Telegram voice notes, gossip, fillers, slang.",
    langMixPctRange: [5, 35],
    emotions: ["happy", "sarcastic", "excited", "tired"],
    styles: ["voice_note", "conversational"],
  },
  {
    id: "code_switching",
    label: "Heavy code-switching",
    labelAr: "خلط عربي إنجليزي",
    description: "Cairo middle-class speech mixing English tech/work terms.",
    langMixPctRange: [30, 60],
    emotions: ["neutral", "professional"],
    styles: ["meeting", "conversational"],
  },
  {
    id: "emotional",
    label: "Emotional / expressive",
    labelAr: "مشاعر",
    description: "Joy, anger, sadness, sarcasm, dramatic phrasing.",
    langMixPctRange: [0, 20],
    emotions: ["angry", "sad", "sarcastic", "excited"],
    styles: ["dramatic", "conversational"],
  },
  {
    id: "numbers_addresses",
    label: "Numbers, addresses & phone",
    labelAr: "أرقام وعناوين",
    description: "Phone numbers, prices in EGP, addresses, dates.",
    langMixPctRange: [0, 20],
    emotions: ["neutral"],
    styles: ["dictation"],
  },
];

export const LENGTH_BUCKETS = ["short", "medium", "long"] as const;
export type LengthBucket = (typeof LENGTH_BUCKETS)[number];

export const LENGTH_TARGETS: Record<LengthBucket, { wordsMin: number; wordsMax: number }> = {
  short: { wordsMin: 3, wordsMax: 8 },
  medium: { wordsMin: 9, wordsMax: 18 },
  long: { wordsMin: 19, wordsMax: 35 },
};
