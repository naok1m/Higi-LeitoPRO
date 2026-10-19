import * as React from "react"
import { useSize } from "../../hooks/use-size"
import { DEFAULT_TRANSFORM_WIDTH } from "./image-helpers"

export function useResponsiveImage({ parsed, fittingType, focalPoint, quality, onLoad }, parentRef) {
  const wrapperRef = React.useRef(null)
  const imgRef = React.useRef(null)
  const size = useSize(wrapperRef)
  const [loaded, setLoaded] = React.useState(false)

  React.useImperativeHandle(parentRef, () => imgRef.current)
  React.useEffect(() => setLoaded(false), [parsed.baseUrl])
  const crop = fittingType !== "fit"
  // Wait for useSize's pre-paint measurement before requesting a transform.
  const options = size && {
    width: size.width || DEFAULT_TRANSFORM_WIDTH,
    height: size.height || undefined,
    crop,
    focalPoint: crop ? focalPoint : undefined,
    quality,
  }

  return {
    wrapperRef, imgRef, loaded, options,
    handleLoad: (event) => {
      setLoaded(true)
      onLoad?.(event)
    },
  }
}
