"use client";
import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Mail, ArrowLeft, CheckCircle2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/hooks/use-translation";
import { BrandLogo } from "@/components/shared/BrandLogo";

const schema = z.object({ email: z.string().email() });
type FormData = z.infer<typeof schema>;

export default function ForgotPasswordPage() {
  const { t, locale } = useTranslation();
  const [sent, setSent]     = useState(false);
  const [loading, setLoading] = useState(false);

  const { register, handleSubmit } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  async function onSubmit(data: FormData) {
    setLoading(true);
    const supabase = createClient();
    await supabase.auth.resetPasswordForEmail(data.email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });
    setLoading(false);
    setSent(true);
  }

  return (
    <div className="w-full max-w-md">
      <div className="bg-white rounded-2xl shadow-modal border border-ink-200 p-8">
        <div className="flex justify-center mb-6"><BrandLogo size={48} /></div>

        {sent ? (
          <div className="text-center">
            <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
            <h1 className="text-[20px] font-bold text-ink-900">
              {locale === "ar" ? "تم إرسال البريد!" : "Email sent!"}
            </h1>
            <p className="mt-2 text-[13px] text-ink-500">
              {locale === "ar"
                ? "تحقق من بريدك الإلكتروني لإعادة تعيين كلمة المرور"
                : "Check your email to reset your password"}
            </p>
          </div>
        ) : (
          <>
            <h1 className="text-[24px] font-bold text-ink-900 text-center tracking-tight">
              {locale === "ar" ? "نسيت كلمة المرور؟" : "Forgot password?"}
            </h1>
            <p className="mt-2 text-[13px] text-ink-500 text-center">
              {locale === "ar"
                ? "أدخل بريدك الإلكتروني وسنرسل لك رابط الاسترداد"
                : "Enter your email and we'll send you a reset link"}
            </p>
            <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4">
              <div className="relative">
                <Mail className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400" />
                <input
                  {...register("email")}
                  type="email" dir="ltr"
                  placeholder="name@company.com"
                  className="w-full h-11 ps-10 pe-4 rounded-xl border border-ink-200 bg-white text-[13px] outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-50"
                />
              </div>
              <button
                type="submit" disabled={loading}
                className="w-full h-11 rounded-xl bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white text-[14px] font-semibold"
              >
                {loading ? t("common.loading") : (locale === "ar" ? "إرسال رابط الاسترداد" : "Send reset link")}
              </button>
            </form>
          </>
        )}
      </div>
      <div className="mt-5 text-center">
        <Link href="/login" className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-500 hover:text-ink-900">
          <ArrowLeft className="w-3.5 h-3.5 rtl-flip" />
          {t("auth.backHome")}
        </Link>
      </div>
    </div>
  );
}
