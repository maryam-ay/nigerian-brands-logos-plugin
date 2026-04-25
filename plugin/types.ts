export type LogoCategory =
  | "Banking" | "Telecom" | "FMCG" | "Media" | "Energy"
  | "Tech" | "Insurance" | "Transport" | "Retail" | "Other";

export interface LogoEntry {
  id: string;
  name: string;
  brand: string;
  category: LogoCategory;
  tags: string[];
  svgUrl: string | null;
  pngUrl: string | null;
  quality: "svg" | "png-hq" | "png-lq";
  figmaNodeId: string;
  figmaComponentKey: string;
  addedAt: string;
  updatedAt: string;
  contributedBy?: {
    handle: string;
    source: "admin" | "community";
    issueNumber?: number;
  };
}

export interface LogosManifest {
  version: string;
  lastUpdated: string;
  totalLogos: number;
  logos: LogoEntry[];
}
