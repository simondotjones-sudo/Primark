'use client';
import type {CourseQuiz,QuizQuestion} from '@/lib/course-quiz';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {NativeSelect} from '@/components/ui/native-select';
import {useLanguage} from '@/components/language-provider';
const question=():QuizQuestion=>({prompt:'',options:['',''],correctIndex:0});
export default function CourseQuizEditor({value,onChange}:{value:CourseQuiz|null;onChange:(quiz:CourseQuiz|null)=>void}){
 const {t}=useLanguage();
 const change=(index:number,next:Partial<QuizQuestion>)=>onChange({...value!,questions:value!.questions.map((q,i)=>i===index?{...q,...next}:q)});
 return <fieldset className="course-certification-fields quiz-editor"><legend>{t('Course quiz')}</legend>
 <label className="quiz-toggle"><input type="checkbox" checked={!!value} onChange={e=>onChange(e.target.checked?{passPercent:80,questions:[question()]}:null)}/>{t('Require a quiz pass')}</label>
 <p className="course-field-help">{t('Applies to new assignments. Learners complete the lessons, then pass this quiz to receive a certificate. Retries do not use credits.')}</p>
 {value&&<><label>{t('Pass mark (%)')}<Input required type="number" min={1} max={100} step={1} value={value.passPercent} onChange={e=>onChange({...value,passPercent:e.target.valueAsNumber})}/></label>
 {value.questions.map((q,index)=><fieldset className="quiz-question" key={index}><legend>{t('Question')} {index+1}</legend>
 <label>{t('Question text')}<textarea required maxLength={1000} value={q.prompt} onChange={e=>change(index,{prompt:e.target.value})}/></label>
 {q.options.map((option,i)=><label key={i}>{t('Answer')} {i+1}<Input required maxLength={500} value={option} onChange={e=>change(index,{options:q.options.map((o,n)=>n===i?e.target.value:o)})}/></label>)}
 <label>{t('Correct answer')}<NativeSelect value={q.correctIndex} onChange={e=>change(index,{correctIndex:Number(e.target.value)})}>{q.options.map((_,i)=><option value={i} key={i}>{t('Answer')} {i+1}</option>)}</NativeSelect></label>
 <div className="editor-actions"><Button type="button" variant="outline" disabled={q.options.length>=6} onClick={()=>change(index,{options:[...q.options,'']})}>{t('Add answer')}</Button><Button type="button" variant="outline" disabled={q.options.length<=2} onClick={()=>change(index,{options:q.options.slice(0,-1),correctIndex:Math.min(q.correctIndex,q.options.length-2)})}>{t('Remove last answer')}</Button><Button type="button" variant="outline" disabled={value.questions.length<=1} onClick={()=>onChange({...value,questions:value.questions.filter((_,i)=>i!==index)})}>{t('Remove question')}</Button></div>
 </fieldset>)}
 <Button type="button" variant="outline" disabled={value.questions.length>=50} onClick={()=>onChange({...value,questions:[...value.questions,question()]})}>{t('Add question')}</Button></>}
 </fieldset>;
}
