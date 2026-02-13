"use client";

import React, { useState } from "react";

type Props = React.ImgHTMLAttributes<HTMLImageElement> & {
  fallbackSrc?: string;
};

export default function SafeImg({ src, fallbackSrc = "/images/hero.jpg", ...rest }: Props) {
  const [imgSrc, setImgSrc] = useState<string>(String(src ?? fallbackSrc));

  return (
    <img
      {...rest}
      src={imgSrc}
      onError={() => setImgSrc(fallbackSrc)}
    />
  );
}