'use client';
import {useLanguage} from '@/components/language-provider';
import PageHeader from '@/components/page-header';
import ManageUsers from '@/components/manage-users';
export default function StoreLearning(){const {t}=useLanguage();return <div className="shell course-admin app-page"><PageHeader title={t("Manage Users")} view="store"/><main className="main"><ManageUsers/></main></div>;}
