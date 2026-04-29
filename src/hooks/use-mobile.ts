import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    // Use callback to set initial value, avoiding setState directly in effect body
    const initialValue = window.innerWidth < MOBILE_BREAKPOINT
    // Schedule the state update outside the effect's synchronous execution
    const raf = requestAnimationFrame(() => setIsMobile(initialValue))
    return () => {
      mql.removeEventListener("change", onChange)
      cancelAnimationFrame(raf)
    }
  }, [])

  return !!isMobile
}
