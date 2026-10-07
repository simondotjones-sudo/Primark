export type ModuleCopy = { title:string; description:string; points:[string,string,string] };
export type QuestionCopy = { q:string; a:[string,string,string] };
export type LocaleCopy = {
  ui: Record<string,string>;
  modules: ModuleCopy[];
  questions: QuestionCopy[];
};
