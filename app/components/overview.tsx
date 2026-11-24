import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";

export const Overview = () => {
  return (
    <motion.div
      key="overview"
      className="w-full h-full flex justify-center items-start pt-16 md:pt-24"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
    >
      <div className="flex flex-col items-center gap-8 max-w-lg px-4 text-center">
        {/* Logo/Icon */}
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.1, duration: 0.3 }}
          className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-accent/80 text-accent-foreground shadow-lg"
        >
          <Sparkles className="h-8 w-8" />
        </motion.div>

        {/* Heading */}
        <div className="space-y-2">
          <motion.h1
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-3xl font-bold tracking-tight"
          >
            Welcome to Isabel
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="text-muted-foreground"
          >
            Your AI-powered security vulnerability management assistant
          </motion.p>
        </div>
      </div>
    </motion.div>
  );
};
