export interface Book {
  name: string;
  author: string;
  bookUrl: string;
  coverUrl?: string;
  lastChapter?: string;
  readProgress?: number;
}

export interface Chapter {
  title: string;
  url: string;
  index: number;
}

export interface BookContent {
  title: string;
  content: string;
  nextUrl?: string;
  prevUrl?: string;
}