import CourseQuiz from './quiz';
export default async function Page({params}:{params:Promise<{id:string}>}){return <CourseQuiz courseId={(await params).id}/>;}
