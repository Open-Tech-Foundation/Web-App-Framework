/** A post record emitted by blogPostsPlugin. */
export interface BlogPost {
  slug: string;
  path: string;
  title: string;
  description?: string;
  date?: string;
  author?: string;
  authorAvatar?: string;
  authorRole?: string;
  cover?: string;
  tags?: string[];
  readingTime: number;
  order?: number;
}
export const posts: BlogPost[];
export default posts;
