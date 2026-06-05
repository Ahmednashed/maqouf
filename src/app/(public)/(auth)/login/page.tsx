"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Mail, Lock, ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/hooks/use-translation";
import { cn } from "@/lib/utils/cn";
import { BrandLogo } from "@/components/shared/BrandLogo";

const schema = z.object({
  email:    z.string().email(),
  password: z.string().min(6),
  remember: z.boolean().optional(),
});
type FormData = z.infer<typeof schema>;

// ─── Skeleton fallback (matches card style, shown while useSearchParams resolves) ─

function LoginSkeleton() {
  return (
    <div className="w-full max-w-md">
      <div className="bg-white rounded-2xl shadow-modal border border-ink-200 p-8 animate-pulse">
        <div className="flex justify-center mb-6">
          <div className="w-12 h-12 rounded-full bg-ink-100" />
        </div>
        <div className="h-6 bg-ink-100 rounded-lg mb-3 mx-auto w-32" />
        <div className="h-4 bg-ink-50 rounded-lg mb-6 mx-auto w-48" />
        <div className="space-y-4">
          <div className="h-11 bg-ink-50 rounded-xl" />
          <div className="h-11 bg-ink-50 rounded-xl" />
          <div className="h-11 bg-brand-50 rounded-xl" />
        </div>
      </div>
    </div>
  );
}

// ─── Inner component (uses useSearchParams — must live inside Suspense) ─────────

function LoginForm() {
  const { t, locale } = useTranslation();
  const router        = useRouter();
  const searchParams  = useSearchParams();
  const [loading, setLoading]   = useState(false);
  const [error,   setError]     = useState("");

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  async function onSubmit(data: FormData) {
    setLoading(true);
    setError("");
    const supabase = createClient();
    const { error: err } = await supabase.auth.signInWithPassword({
      email:    data.email,
      password: data.password,
    });
    if (err) {
      setError(locale === "ar" ? "البريد الإلكتروني أو كلمة المرور غير صحيحة" : "Invalid email or password");
      setLoading(false);
      return;
    }
    const redirect = searchParams.get("redirect") ?? "/dashboard";
    router.push(redirect);
  }

  return (
    <div className="w-full max-w-md">
      <div className="bg-white rounded-2xl shadow-modal border border-ink-200 p-8">
        <div className="flex justify-center mb-6">
          <BrandLogo size={48} />
        </div>
        <h1 className="text-[24px] font-bold text-ink-900 text-center tracking-tight">
          {t("auth.login")}
        </h1>
        <p className="mt-2 text-[13px] text-ink-500 text-center">
          {locale === "ar" ? "سجّل دخولك للوصول إلى لوحة التحكم" : "Sign in to access your dashboard"}
        </p>

        {error && (
          <div className="mt-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-[12.5px] text-rose-700 font-medium">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4">
          <div>
            <label className="block text-[12.5px] font-semibold text-ink-700 mb-1.5">
              {t("auth.email")}
            </label>
            <div className="relative">
              <Mail className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400" />
              <input
                {...register("email")}
                type="email"
                dir="ltr"
                placeholder="name@company.com"
                className={cn(
                  "w-full h-11 ps-10 pe-4 rounded-xl border bg-white text-[13px] outline-none transition-all",
                  "focus:border-brand-500 focus:ring-2 focus:ring-brand-50",
                  errors.email ? "border-rose-400" : "border-ink-200"
                )}
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-[12.5px] font-semibold text-ink-700">
                {t("auth.password")}
              </label>
              <Link href="/forgot-password" className="text-[11.5px] font-semibold text-brand-500 hover:text-brand-600">
                {t("auth.forgotPassword")}
              </Link>
            </div>
            <div className="relative">
              <Lock className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400" />
              <input
                {...register("password")}
                type="password"
                placeholder="••••••••"
                className={cn(
                  "w-full h-11 ps-10 pe-4 rounded-xl border bg-white text-[13px] outline-none transition-all",
                  "focus:border-brand-500 focus:ring-2 focus:ring-brand-50",
                  errors.password ? "border-rose-400" : "border-ink-200"
                )}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full h-11 rounded-xl bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white text-[14px] font-semibold shadow-pop transition-all"
          >
            {loading ? t("common.loading") : t("auth.login")}
          </button>
        </form>

        <div className="mt-6 pt-6 border-t border-ink-100 text-center">
          <span className="text-[12.5px] text-ink-500">{t("auth.noAccount")} </span>
          <Link href="/signup" className="text-[12.5px] font-semibold text-brand-500 hover:text-brand-600">
            {t("auth.signup")}
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

// ─── Page export — wraps LoginForm in Suspense so useSearchParams is safe ───────

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginSkeleton />}>
      <LoginForm />
    </Suspense>
  );
}
