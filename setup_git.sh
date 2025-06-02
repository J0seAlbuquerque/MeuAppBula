#!/bin/bash

# Script to set up global Git configuration

echo "Setting up global Git configuration..."

# Prompt for user name
read -p "Enter your full name for Git commits: " GIT_USER_NAME

# Prompt for user email
read -p "Enter your email for Git commits: " GIT_USER_EMAIL

# Set global user name
git config --global user.name "$GIT_USER_NAME"

# Set global user email
git config --global user.email "$GIT_USER_EMAIL"

# Set default branch name to main
git config --global init.defaultBranch main

# Configure pull behavior to rebase by default
git config --global pull.rebase true

# Configure line endings
git config --global core.autocrlf input

# Display current Git configuration
echo -e "\nYour global Git configuration:"
git config --global --list

echo -e "\nGit configuration completed successfully!"
echo "You can modify these settings anytime using 'git config --global' commands."

