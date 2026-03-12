import type { ComponentProps, ReactElement } from 'react'
import { PhotoProvider, PhotoView } from 'react-photo-view'

type PhotoViewerProviderProps = ComponentProps<typeof PhotoProvider>

export function PhotoViewerProvider({
  children,
  loop = 3,
  maskOpacity = 0.94,
  photoClosable = true,
  maskClosable = true,
  pullClosable = true,
  ...props
}: PhotoViewerProviderProps) {
  return (
    <PhotoProvider
      loop={loop}
      maskOpacity={maskOpacity}
      photoClosable={photoClosable}
      maskClosable={maskClosable}
      pullClosable={pullClosable}
      {...props}
    >
      {children}
    </PhotoProvider>
  )
}

type PhotoViewerProps = Omit<ComponentProps<typeof PhotoView>, 'children' | 'src'> & {
  src?: string | null
  children: ReactElement
}

export function PhotoViewer({ src, children, ...props }: PhotoViewerProps) {
  if (!src) {
    return children
  }

  return (
    <PhotoView src={src} {...props}>
      {children}
    </PhotoView>
  )
}
