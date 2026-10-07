import PasswordRecoveryForm from '@/components/password-recovery-form';
export const metadata = {title:'Reset password · Primark',robots:{index:false,follow:false},referrer:'no-referrer' as const};
export default function ResetPasswordPage() { return <PasswordRecoveryForm reset/>; }
