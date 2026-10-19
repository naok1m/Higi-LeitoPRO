import React from "react";
import LogoFooter from "@/components/LogoFooter";

export default function AuthLayout({ icon: Icon = null, imageSrc, imageAlt = "", title, subtitle, footer, children }) {
  return (
    <div className="min-h-screen flex flex-col bg-background px-4">
      <div className="w-full max-w-md flex-1 flex flex-col justify-center mx-auto">
        <div className="text-center mb-10">
          {imageSrc ? (
            <img src={imageSrc} alt={imageAlt} className="w-28 h-28 object-contain mx-auto mb-4 rounded-2xl" />
          ) : Icon ? (
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary mb-4">
              <Icon className="w-7 h-7 text-primary-foreground" aria-hidden="true" />
            </div>
          ) : null}
          <h1 className="text-3xl font-bold tracking-tight text-foreground">{title}</h1>
          {subtitle && <p className="text-muted-foreground mt-2">{subtitle}</p>}
        </div>
        <div className="bg-card rounded-2xl shadow-sm border border-border p-8">
          {children}
        </div>
        {footer && (
          <p className="text-center text-sm text-muted-foreground mt-6">{footer}</p>
        )}
      </div>
      <LogoFooter />
    </div>
  );
}
