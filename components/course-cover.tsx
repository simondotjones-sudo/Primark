import Image from 'next/image';
import type { CourseCoverKey } from '@/lib/course-covers';
import safetyPass from '@/public/course-images/safety-pass.png';
import manualHandling from '@/public/course-images/manual-handling.png';
import security from '@/public/course-images/security.png';
import dignity from '@/public/course-images/dignity.png';
import speakUp from '@/public/course-images/speak-up.png';
import dataProtection from '@/public/course-images/data-protection.png';
import accessibility from '@/public/course-images/accessibility.png';
import safeguarding from '@/public/course-images/safeguarding.png';
import fireSafety from '@/public/course-images/fire-safety.webp';
import emergencyResponse from '@/public/course-images/emergency-response.webp';
import balerSafety from '@/public/course-images/baler-safety.webp';
import nightWork from '@/public/course-images/night-work.webp';

const covers = {
  'safety-pass': safetyPass, 'manual-handling': manualHandling,
  security, dignity, 'speak-up': speakUp, 'data-protection': dataProtection,
  accessibility, safeguarding, 'fire-safety': fireSafety,
  'emergency-response': emergencyResponse, 'baler-safety': balerSafety,
  'night-work': nightWork,
};

export default function CourseCover({coverKey, sizes}: {coverKey: CourseCoverKey; sizes: string}) {
  return <Image src={covers[coverKey] || safetyPass} alt="" fill
    placeholder="blur" sizes={sizes} className="course-cover-image" data-cover={coverKey} />;
}
