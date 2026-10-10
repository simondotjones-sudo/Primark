'use client';
import {useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {useLanguage} from '@/components/language-provider';
import '../player.css';
type Quiz={assignmentId:string;title:string;passed:boolean;lessonsComplete:boolean;passPercent:number;questions:{prompt:string;options:string[]}[]};
export default function CourseQuiz({courseId}:{courseId:string}){
 const {t}=useLanguage(),[quiz,setQuiz]=useState<Quiz|null>(null),[answers,setAnswers]=useState<Record<number,number>>({}),[error,setError]=useState(''),[busy,setBusy]=useState(false),[result,setResult]=useState<{correct:number;total:number;passed:boolean}|null>(null),[attemptId,setAttemptId]=useState('');
 useEffect(()=>{const controller=new AbortController();setAttemptId(crypto.randomUUID());fetch('/api/courses/quiz?'+new URLSearchParams({courseId}),{signal:controller.signal,cache:'no-store'}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error);setQuiz(d);}).catch(e=>{if(e.name!=='AbortError')setError(e.message);});return()=>controller.abort();},[courseId]);
 async function submit(){
  setBusy(true);setError('');try{
   const r=await fetch('/api/courses/quiz',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({courseId,assignmentId:quiz!.assignmentId,attemptId,answers:quiz!.questions.map((_,i)=>answers[i])})}),d=await r.json();
   if(!r.ok)throw new Error(d.error);setResult(d);
  }catch(e){setError(e instanceof Error?e.message:'Please try again.');}finally{setBusy(false);}
 }
 return <div className="shell"><header className="player-toolbar"><span className="player-wordmark">PRIMARK</span><a href="/?courses=1">{t('My Courses')}</a></header><main className="main quiz-page"><div className="paper">
 <h1>{quiz?.title||t('Course quiz')}</h1>{error&&<p className="error" role="alert">{t(error)}</p>}
 {!quiz&&!error?<p>{t('Loading…')}</p>:quiz&&(result?.passed||quiz.passed)?<div role="status"><h2>{t('You passed. Well done.')}</h2>{result&&<p>{result.correct}/{result.total}</p>}<a href="/?courses=1">{t('View certificate')}</a></div>:quiz&&!quiz.lessonsComplete?<><p>{t('Complete the lessons before taking the quiz.')}</p><a href={`/learn/${courseId}/`}>{t('Continue course')}</a></>:quiz&&result?<div role="status"><h2>{t('You can try again.')}</h2><p>{result.correct}/{result.total} · {t('Pass mark')} {quiz.passPercent}%</p><Button onClick={()=>{setResult(null);setAnswers({});setAttemptId(crypto.randomUUID());}}>{t('Retry quiz')}</Button></div>:quiz&&<form onSubmit={e=>{e.preventDefault();void submit();}}><p>{t('Pass mark')} {quiz.passPercent}% · {quiz.questions.length} {t(quiz.questions.length===1?'Question':'questions')}</p>
 <fieldset disabled={busy}>{quiz.questions.map((q,i)=><fieldset className="quiz-question" key={i}><legend>{i+1}. {q.prompt}</legend>{q.options.map((answer,j)=><label className="quiz-answer" key={j}><input required type="radio" name={'question-'+i} checked={answers[i]===j} onChange={()=>setAnswers({...answers,[i]:j})}/>{answer}</label>)}</fieldset>)}</fieldset>
 <Button disabled={busy||Object.keys(answers).length!==quiz.questions.length}>{t(busy?'Saving…':'Submit answers')}</Button></form>}
 </div></main></div>;
}
