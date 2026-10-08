'use client';
import {useLanguage} from '@/components/language-provider';
import ManageUsers from '@/components/manage-users';
import PageHeader from '@/components/page-header';
export default function ReportingAccessAdmin(){const {t}=useLanguage();return <div className="shell course-admin access-admin app-page"><PageHeader title={t('Manage Users')} view="access"/><main className="main"><ManageUsers/></main></div>;}
