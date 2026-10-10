export type QuizQuestion={prompt:string;options:string[];correctIndex:number};
export type CourseQuiz={passPercent:number;questions:QuizQuestion[]};
export function validateQuiz(value:unknown):CourseQuiz|null{
 if(value===null)return null;
 const q=value as CourseQuiz;
 if(!q||!Number.isInteger(q.passPercent)||q.passPercent<1||q.passPercent>100||!Array.isArray(q.questions)||q.questions.length<1||q.questions.length>50)throw new Error('Add 1–50 questions and a pass mark from 1 to 100%.');
 return {passPercent:q.passPercent,questions:q.questions.map(item=>{
  if(!item||typeof item.prompt!=='string'||!item.prompt.trim()||item.prompt.length>1000||!Array.isArray(item.options)||item.options.length<2||item.options.length>6||item.options.some(v=>typeof v!=='string'||!v.trim()||v.length>500)||!Number.isInteger(item.correctIndex)||item.correctIndex<0||item.correctIndex>=item.options.length)throw new Error('Each question needs 2–6 answers and one correct answer.');
  return {prompt:item.prompt.trim(),options:item.options.map(v=>v.trim()),correctIndex:item.correctIndex};
 })};
}
export function markQuiz(quiz:CourseQuiz,answers:unknown){
 if(!Array.isArray(answers)||answers.length!==quiz.questions.length||answers.some((a,i)=>!Number.isInteger(a)||a<0||a>=quiz.questions[i].options.length))throw new Error('Answer every question before submitting.');
 const correct=answers.filter((a,i)=>a===quiz.questions[i].correctIndex).length;
 return {correct,total:answers.length,passPercent:quiz.passPercent,passed:correct*100>=quiz.passPercent*answers.length};
}
