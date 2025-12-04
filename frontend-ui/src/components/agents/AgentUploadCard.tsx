import React, { useState, useCallback, useRef } from 'react'
import { Upload, File, AlertCircle, CheckCircle, Loader2 } from 'lucide-react'
import { apiClient } from '../../services/ApiClient'
import type { AgentUploadResponse } from '../../lib/api-types'

interface AgentUploadCardProps {
  onUploadComplete?: (result: AgentUploadResponse) => void
  onError?: (error: string) => void
}

type UploadState = 'idle' | 'dragging' | 'uploading' | 'success' | 'error'

export function AgentUploadCard({ onUploadComplete, onError }: AgentUploadCardProps) {
  const [state, setState] = useState<UploadState>('idle')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [uploadResult, setUploadResult] = useState<AgentUploadResponse | null>(null)
  const [errorMessage, setErrorMessage] = useState<string>('')
  const [warnings, setWarnings] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setState('dragging')
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setState('idle')
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setState('idle')

    const files = e.dataTransfer.files
    if (files.length > 0) {
      const file = files[0]
      if (file.name.endsWith('.zip')) {
        setSelectedFile(file)
        setErrorMessage('')
      } else {
        setErrorMessage('Please upload a .zip file')
      }
    }
  }, [])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files && files.length > 0) {
      const file = files[0]
      if (file.name.endsWith('.zip')) {
        setSelectedFile(file)
        setErrorMessage('')
      } else {
        setErrorMessage('Please upload a .zip file')
      }
    }
  }, [])

  const handleUpload = useCallback(async () => {
    if (!selectedFile) return

    setState('uploading')
    setErrorMessage('')
    setWarnings([])

    try {
      const result = await apiClient.uploadAgentPackage(selectedFile)
      setUploadResult(result)
      setWarnings(result.warnings || [])
      setState('success')
      onUploadComplete?.(result)
    } catch (error: any) {
      const message = error?.message || error?.errors?.join(', ') || 'Upload failed'
      setErrorMessage(message)
      setWarnings(error?.warnings || [])
      setState('error')
      onError?.(message)
    }
  }, [selectedFile, onUploadComplete, onError])

  const handleReset = useCallback(() => {
    setState('idle')
    setSelectedFile(null)
    setUploadResult(null)
    setErrorMessage('')
    setWarnings([])
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }, [])

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <div className="w-full">
      {/* Drop Zone */}
      <div
        className={`
          relative border-2 border-dashed rounded-lg p-8 text-center transition-all
          ${state === 'dragging' ? 'border-blue-500 bg-blue-50' : ''}
          ${state === 'idle' && !selectedFile ? 'border-gray-300 hover:border-gray-400' : ''}
          ${selectedFile && state === 'idle' ? 'border-green-400 bg-green-50' : ''}
          ${state === 'success' ? 'border-green-500 bg-green-50' : ''}
          ${state === 'error' ? 'border-red-400 bg-red-50' : ''}
        `}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".zip"
          onChange={handleFileSelect}
          className="hidden"
        />

        {/* Idle state - no file selected */}
        {state === 'idle' && !selectedFile && (
          <div className="space-y-4">
            <Upload className="w-12 h-12 mx-auto text-gray-400" />
            <div>
              <p className="text-gray-600">Drag and drop your agent package here</p>
              <p className="text-sm text-gray-400 mt-1">or</p>
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Browse Files
            </button>
            <p className="text-xs text-gray-400 mt-2">
              Accepts .zip files up to 50MB
            </p>
          </div>
        )}

        {/* Dragging state */}
        {state === 'dragging' && (
          <div className="space-y-4">
            <Upload className="w-12 h-12 mx-auto text-blue-500 animate-bounce" />
            <p className="text-blue-600 font-medium">Drop your file here</p>
          </div>
        )}

        {/* File selected - ready to upload */}
        {selectedFile && state === 'idle' && (
          <div className="space-y-4">
            <File className="w-12 h-12 mx-auto text-green-500" />
            <div>
              <p className="font-medium text-gray-800">{selectedFile.name}</p>
              <p className="text-sm text-gray-500">{formatFileSize(selectedFile.size)}</p>
            </div>
            <div className="flex gap-2 justify-center">
              <button
                onClick={handleUpload}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
              >
                Upload & Validate
              </button>
              <button
                onClick={handleReset}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Uploading state */}
        {state === 'uploading' && (
          <div className="space-y-4">
            <Loader2 className="w-12 h-12 mx-auto text-blue-500 animate-spin" />
            <p className="text-blue-600 font-medium">Uploading and validating...</p>
            <p className="text-sm text-gray-500">This may take a moment</p>
          </div>
        )}

        {/* Success state */}
        {state === 'success' && uploadResult && (
          <div className="space-y-4">
            <CheckCircle className="w-12 h-12 mx-auto text-green-500" />
            <div>
              <p className="font-medium text-green-700">Upload Successful!</p>
              <p className="text-sm text-gray-600 mt-1">
                {uploadResult.name} v{uploadResult.version}
              </p>
              <p className="text-xs text-gray-500">
                Status: {uploadResult.validationStatus}
              </p>
            </div>
            {warnings.length > 0 && (
              <div className="bg-yellow-50 border border-yellow-200 rounded p-3 text-left">
                <p className="text-xs font-medium text-yellow-800 mb-1">Warnings:</p>
                <ul className="text-xs text-yellow-700 list-disc list-inside">
                  {warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            )}
            <button
              onClick={handleReset}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Upload Another
            </button>
          </div>
        )}

        {/* Error state */}
        {state === 'error' && (
          <div className="space-y-4">
            <AlertCircle className="w-12 h-12 mx-auto text-red-500" />
            <div>
              <p className="font-medium text-red-700">Upload Failed</p>
              <p className="text-sm text-red-600 mt-1">{errorMessage}</p>
            </div>
            {warnings.length > 0 && (
              <div className="bg-yellow-50 border border-yellow-200 rounded p-3 text-left">
                <p className="text-xs font-medium text-yellow-800 mb-1">Warnings:</p>
                <ul className="text-xs text-yellow-700 list-disc list-inside">
                  {warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            )}
            <button
              onClick={handleReset}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
            >
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
