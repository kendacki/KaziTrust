import { motion, type HTMLMotionProps } from "framer-motion";
import type { ReactNode } from "react";

export const ease = [0.22, 1, 0.36, 1] as const;

export const rise = {
  hidden: { opacity: 0, y: 22 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease } },
};

export const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.04 } },
};

export function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.7, ease, delay }}
    >
      {children}
    </motion.div>
  );
}

export function CardGrid({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <motion.div className={className} variants={stagger} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-60px" }}>
      {children}
    </motion.div>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return (
    <motion.article variants={rise} whileHover={{ y: -4 }} transition={{ duration: 0.35, ease }}>
      {children}
    </motion.article>
  );
}

type LineProps = HTMLMotionProps<"span"> & { index?: number };

export function Line({ index = 0, children, ...props }: LineProps) {
  return (
    <motion.span
      initial={{ opacity: 0, y: 28 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, ease, delay: 0.08 + index * 0.12 }}
      {...props}
    >
      {children}
    </motion.span>
  );
}
