"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Building2, User, Mail, Phone, Lock, Gift, ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/hooks/use-translation";
import { cn } from "@/lib/utils/cn";
import { BrandLogo } from "@/components/shared/BrandLogo";

const schema = z.object({
  company_name: z.string().min(2),
  full_name:    z.string().min(2),
  email:        z.string().email(),
  phone:        z.string().optional(),
  password:     z.string().min(8),
  terms:        z.boolean().refine((v) => v === true),
});
type FormData = z.infer<typeof schema>;

export default function SignupPage() {
  const { t, locale } = useTranslation();
  const router        = useRouter();
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  async function onSubmit(data: FormData) {
    setLoading(true);
    setError("");
    const supabase = createClient();

    const { error: err } = await supabase.auth.signUp({
      email:    data.email,
      password: data.password,
      options: {
        data: {
          full_name:    data.full_name,
          company_name: data.company_name,
          phone:        data.phone,
        },
      },
    });

    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    router.push("/dashboard");
  }

  const inputClass = (hasError?: boolean) => cn(
    "w-full h-11 ps-10 pe-4 rounded-xl border bg-white text-[13px] outline-none transition-all",
    "focus:border-brand-500 focus:ring-2 focus:ring-brand-50",
    hasError ? "border-rose-400" : "border-ink-200"
  );

  return (
    <div className="w-full max-w-md">
      <div className="bg-white rounded-2xl shadow-modal border border-ink-200 p-8">
        <div className="flex justify-center mb-6">
          <BrandLogo size={48} />
        </div>
        <h1 className="text-[24px] font-bold text-ink-900 text-center tracking-tight">
          {t("auth.startTrial")}
        </h1>
        <div className="mt-3 inline-flex w-full items-center justify-center gap-2 py-2 rounded-lg bg-emerald-50 text-emerald-700 text-[12px] font-semibold">
          <Gift className="w-4 h-4" />
          {t("auth.trialBadge")}
        </div>

        {error && (
          <div className="mt-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-[12.5px] text-rose-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="mt-5 space-y-4">
          <div>
            <label className="block text-[12.5px] font-semibold text-ink-700 mb-1.5">{t("auth.companyName")} *</label>
            <div className="relative">
              <Building2 className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400" />
              <input {...register("company_name")} className={inputClass(!!errors.company_name)} />
            </div>
          </div>
          <div>
            <label className="block text-[12.5px] font-semibold text-ink-700 mb-1.5">{t("auth.fullName")} *</label>
            <div className="relative">
              <User className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400" />
              <input {...register("full_name")} className={inputClass(!!errors.full_name)} />
            </div>
          </div>
          <div>
            <label className="block text-[12.5px] font-semibold text-ink-700 mb-1.5">{t("auth.email")} *</label>
            <div className="relative">
              <Mail className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400" />
              <input {...register("email")} type="email" dir="ltr" className={inputClass(!!errors.email)} />
            </div>
          </div>
          <div>
            <label className="block text-[12.5px] font-semibold text-ink-700 mb-1.5">{t("auth.phone")}</label>
            <div className="relative">
              <Phone className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400" />
              <input {...register("phone")} type="tel" dir="ltr" placeholder="+966 5X XXX XXXX" className={inputClass()} />
            </div>
          </div>
          <div>
            <label className="block text-[12.5px] font-semibold text-ink-700 mb-1.5">{t("auth.password")} *</label>
            <div className="relative">
              <Lock className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400" />
              <input {...register("password")} type="password" placeholder="••••••••" className={inputClass(!!errors.password)} />
            </div>
          </div>
          <label className="flex items-start gap-2 cursor-pointer">
            <input {...register("terms")} type="checkbox" className="mt-0.5 w-4 h-4 rounded border-ink-300 text-brand-500" />
            <span className="text-[12px] text-ink-600">{t("auth.terms")}</span>
          </label>

          <button
            type="submit"
            disabled={loading}
            className="w-full h-11 rounded-xl bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white text-[14px] font-semibold shadow-pop transition-all"
          >
            {loading ? t("common.loading") : t("auth.startTrial")}
          </button>
        </form>

        <div className="mt-6 pt-6 border-t border-ink-100 text-center">
          <span className="text-[12.5px] text-ink-500">{t("auth.haveAccount")} </span>
          <Link href="/login" className="text-[12.5px] font-semibold text-brand-500 hover:text-brand-600">
            {t("auth.login")}
          </Link>
        </div>
      </div>
      <div className="mt-5 text-center">
        <Link href="/" className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-500 hover:text-ink-900">
          <ArrowLeft className="w-3.5 h-3.5 rtl-flip" />
          {t("auth.backHome")}
        </Link>
      </div>
    </div>
  );
}
